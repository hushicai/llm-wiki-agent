// src/core/agent.ts — WikiAgent: core abstraction for llm-wiki-agent
// Manages config (~/.llm-wiki-agent/), creates sessions, lists models.
import {
  createAgentSession,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { readFileSync } from "fs";
import { join } from "path";
import { getAgentDir, getSessionDir, slugify } from "./config.js";
import { getRepoRoot } from "../utils/resolve.js";
import { createSubagentTool } from "../tools/subagent.js";

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
  /** Restrict to specific SDK built-in tool names (e.g. ["read","bash","grep"]) */
  allowedTools?: string[];
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

function loadMainAgentPrompt(): string | undefined {
  const repoRoot = getRepoRoot();
  const promptPath = join(repoRoot, "dispatcher/prompt.md");
  try {
    const content = readFileSync(promptPath, "utf-8");
    return `\n${content}\n`; // SDK expects string, add padding like the old template
  } catch {
    return undefined;
  }
}

function loadSubagentPrompt(role: string, wikiRoot?: string): string | undefined {
  const repoRoot = getRepoRoot();
  const agentsDir = join(repoRoot, "agents");
  const filePath = join(agentsDir, `wiki-${role}.md`);
  try {
    const content = readFileSync(filePath, "utf-8");
    const { body } = parseFrontmatter(content);
    // Replace {wikiRoot} placeholder with actual wiki path
    if (wikiRoot) {
      return body.replace(/\{wikiRoot\}/g, wikiRoot);
    }
    return body;
  } catch {
    return undefined;
  }
}

// === WikiAgent ===

export class WikiAgent {
  private agentDir: string;
  private cachedModels: ModelInfo[] | null;

  constructor() {
    this.agentDir = getAgentDir();
    this.cachedModels = null;
  }

  async createSession(wikiRoot: string, options?: CreateSessionOptions) {
    const { role, appendSystemPrompt: extraPrompts } = options ?? {};

    const wikiSlug = slugify(wikiRoot.split("/").pop() || "wiki");
    const sessionDir = getSessionDir(wikiSlug);
    const sessionManager = SessionManager.create(wikiRoot, sessionDir);

    const svc = await createAgentSessionServices({
      cwd: wikiRoot,
      agentDir: this.agentDir,
      resourceLoaderOptions: {
        // 关闭 SDK 自动发现
        noExtensions: true,
        noSkills: true,

        // CLI --append-system-prompt 追加到 dispatcher prompt 末尾
        ...(extraPrompts && extraPrompts.length > 0 && {
          appendSystemPrompt: extraPrompts,
        }),

        // 主 agent（role 为空）：显式加载 dispatcher prompt
        ...(function () {
          const mainPrompt = loadMainAgentPrompt();
          if (mainPrompt && !role) {
            return { systemPrompt: mainPrompt };
          }
          return undefined;
        })(),

        ...(role && {
          // Subagent 模式：禁用所有 extension，传入自定义 system prompt
          systemPrompt: loadSubagentPrompt(role, wikiRoot),
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
        const toolOpts = !role
          ? { noTools: "builtin" as const, customTools: [createSubagentTool(wikiRoot)] }
          : options?.allowedTools
            ? { tools: options.allowedTools }
            : {};
        const result = await createAgentSession({
          ...opts,
          agentDir: this.agentDir,
          resourceLoader: svc.resourceLoader,
          modelRegistry: svc.modelRegistry,
          sessionManager,
          ...toolOpts,
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
