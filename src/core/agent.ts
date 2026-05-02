// src/core/agent.ts — WikiAgent: core abstraction for llm-wiki-agent
// Manages config (~/.llm-wiki-agent/), creates sessions, lists models.
import {
  createAgentSession,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
  type ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import { existsSync } from "fs";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { getAgentDir, getSessionDir, slugify } from "./config.js";

export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow?: number;
}

export interface CreateSessionOptions {
  /** Subagent role (ingest/query/lint), undefined for main agent */
  role?: string;
  /** Additional system prompt content to append */
  appendSystemPrompt?: string[];
}

// === Subagent prompt loading ===

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) {
      frontmatter[key.trim()] = rest.join(":").trim();
    }
  }
  return { frontmatter, body: match[2] };
}

function loadSubagentPrompt(role: string): string[] {
  const repoRoot = join(__dirname, "../.."); // src/core/ -> 项目根
  const agentsDir = join(repoRoot, "agents");
  const filePath = join(agentsDir, `wiki-${role}.md`);
  try {
    const content = readFileSync(filePath, "utf-8");
    const { body } = parseFrontmatter(content);
    return body.split("\n");
  } catch {
    return [];
  }
}

// === WikiAgent ===

export class WikiAgent {
  private agentDir: string;
  private systemPromptLines: string[];
  private cachedModels: ModelInfo[] | null;

  constructor() {
    this.agentDir = getAgentDir();
    this.systemPromptLines = this.loadSystemPromptSync();
    this.cachedModels = null;
  }

  private loadSystemPromptSync(): string[] {
    try {
      const promptPath = new URL(
        "../templates/system-prompt-template.md",
        import.meta.url,
      ).pathname;
      const content = readFileSync(promptPath, "utf-8");
      return ["", ...content.split("\n"), ""];
    } catch {
      return [];
    }
  }

  async createSession(wikiRoot: string, options?: CreateSessionOptions) {
    const { role, appendSystemPrompt: extraPrompts } = options ?? {};

    // 仓库根目录（用于 extensions/ 和 skills/）
    // 使用 import.meta.url 获取当前文件位置，然后回溯
    const currentFile = fileURLToPath(import.meta.url);
    const repoRoot = join(currentFile, "../.."); // src/core/ -> 项目根
    const extensionsDir = join(repoRoot, "extensions");
    const skillsDir = join(repoRoot, "skills");

    const wikiSlug = slugify(wikiRoot.split("/").pop() || "wiki");
    const sessionDir = getSessionDir(wikiSlug);
    const sessionManager = SessionManager.create(wikiRoot, sessionDir);

    // 动态加载 wiki-subagent extension factory
    let extensionFactories: ExtensionFactory[] = [];
    if (!role) {
      try {
        const extModule = await import(join(extensionsDir, "wiki-subagent.js"));
        extensionFactories = [extModule.default];
      } catch {
        // Extension 加载失败，继续运行（可能没有 wiki-subagent）
      }
    }

    const svc = await createAgentSessionServices({
      cwd: wikiRoot,
      agentDir: this.agentDir,
      resourceLoaderOptions: {
        // 关闭 SDK 自动发现
        noExtensions: true,
        noSkills: true,

        // 显式传入 extension factories（通过动态 import）
        ...(extensionFactories.length > 0 && {
          extensionFactories,
        }),

        // Skills 使用 additionalSkillPaths（SDK 能正确处理目录）
        ...(existsSync(skillsDir) && !role && {
          additionalSkillPaths: [skillsDir],
        }),

        appendSystemPrompt: [
          ...this.systemPromptLines,
          ...(extraPrompts ?? []),
        ],

        ...(role && {
          // Subagent 模式：禁用所有 extension，传入自定义 system prompt
          systemPrompt: loadSubagentPrompt(role),
        }),
      },
    });

    // Cache model info for getModels()
    if (!this.cachedModels) {
      this.cachedModels = svc.modelRegistry.getAvailable().map((m: any) => ({
        id: m.id,
        provider: m.provider,
        contextWindow: m.contextWindow,
      }));
    }

    // Fire-and-forget context window probe
    this.probeContextWindows(svc);

    const runtime = await createAgentSessionRuntime(
      async (opts: any) => {
        const result = await createAgentSession({
          ...opts,
          agentDir: this.agentDir,
          resourceLoader: svc.resourceLoader,
          modelRegistry: svc.modelRegistry,
          sessionManager,
        });
        return { ...result, services: svc, diagnostics: svc.diagnostics };
      },
      { cwd: wikiRoot, agentDir: this.agentDir, sessionManager },
    );

    return runtime;
  }

  getModels(): ModelInfo[] {
    return this.cachedModels ?? [];
  }

  private async probeContextWindows(svc: any): Promise<void> {
    const DEFAULT_CTX = 128000;
    const registry = svc.modelRegistry;
    const models = registry.getAvailable();
    const providerModels = new Map<string, any[]>();

    for (const m of models) {
      if (m.contextWindow && m.contextWindow !== DEFAULT_CTX) continue;
      const list = providerModels.get(m.provider) ?? [];
      list.push(m);
      providerModels.set(m.provider, list);
    }

    for (const [provider, list] of providerModels) {
      if (list.length === 0) continue;
      const baseUrl = list[0].baseUrl;
      if (!baseUrl) continue;
      const auth = await registry.getApiKeyAndHeaders(list[0]);
      if (!auth.ok) continue;

      try {
        const url = baseUrl.replace(/\/+$/, "") + "/models";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (auth.apiKey) headers["Authorization"] = `Bearer ${auth.apiKey}`;
        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(1000),
        });
        if (!response.ok) continue;
        const data = (await response.json()) as any;
        const modelList: any[] = data?.data ?? [];
        for (const entry of modelList) {
          const ctxLen =
            entry?.meta?.context_length ?? entry?.context_window;
          if (!ctxLen) continue;
          const match = list.find((m: any) => m.id === entry.id);
          if (
            match &&
            (!match.contextWindow || match.contextWindow === DEFAULT_CTX)
          ) {
            (match as any).contextWindow = ctxLen;
          }
        }
      } catch {
        /* timeout — use default */
      }
    }
  }

  async dispose(): Promise<void> {
    this.cachedModels = null;
  }
}
