// src/core/agent.ts — WikiAgent: core abstraction for llm-wiki-agent
// Manages config (~/.llm-wiki-agent/), creates sessions, lists models.
import {
  createAgentSession,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { AgentSessionServices, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { CreateAgentSessionRuntimeFactory } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { readFileSync } from "fs";
import { join } from "path";
import { getAgentDir, getSessionDir, slugify } from "./config.js";
import { getRepoRoot } from "../utils/resolve.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { customToolFactories } from "../tools/index.js";


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
  /** 工具名允许列表。可混合 SDK 内置工具名（read/bash/edit/write/grep/find/ls）和自定义工具名。
   *  工具名在 CUSTOM_TOOL_NAMES 中 → 通过工厂生成 ToolDefinition，传入 `customTools`。
   *  不在 CUSTOM_TOOL_NAMES 中 → 直接作为内置工具名传入 `tools` 字段。
   *  如果解析后无内置工具名，自动传入 `noTools: "builtin"` 禁用内置工具。
   *  空/undefined 时使用 SDK 全量默认内置工具。 */
  allowedTools?: string[];
}

// 自定义工具名集合：从注册表自动发现，不人工维护
const CUSTOM_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(customToolFactories));

// 自定义工具工厂：从注册表查找
function createCustomTool(name: string, wikiRoot: string): ToolDefinition | undefined {
  const factory = customToolFactories[name];
  return factory ? factory(wikiRoot) : undefined;
}

// === Tool config 解析 ===

interface ResolvedTools {
  builtin?: string[];
  custom?: ToolDefinition[];
  noBuiltin: boolean;
}

/**
 * 从工具名列表中分离内置和自定义工具。
 * 在 CUSTOM_TOOL_NAMES 中的 → 自定义工具，通过工厂生成 ToolDefinition 传入 `customTools`。
 * 不在 CUSTOM_TOOL_NAMES 中的 → 内置工具，直接传入 `tools` 字段。
 */
function resolveToolConfig(names: string[] | undefined, wikiRoot: string): ResolvedTools {
  if (!names || names.length === 0) {
    return { noBuiltin: false };
  }

  const builtin: string[] = [];
  const custom: ToolDefinition[] = [];

  for (const name of names) {
    if (CUSTOM_TOOL_NAMES.has(name)) {
      const def = createCustomTool(name, wikiRoot);
      if (def) custom.push(def);
    } else {
      builtin.push(name);
    }
  }

  return {
    ...(builtin.length > 0 ? { builtin } : {}),
    ...(custom.length > 0 ? { custom } : {}),
    noBuiltin: builtin.length === 0,
  };
}

// === Agent prompt 加载 ===

interface AgentConfig {
  systemPrompt: string | undefined;
  tools: string[] | undefined;
}

function loadMainAgentConfig(): AgentConfig {
  const repoRoot = getRepoRoot();
  const promptPath = join(repoRoot, "dispatcher/prompt.md");
  try {
    const content = readFileSync(promptPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    const tools = frontmatter.tools
      ? String(frontmatter.tools).split(",").map((t: string) => t.trim()).filter(Boolean)
      : undefined;
    return {
      systemPrompt: `\n${body}\n`,
      tools,
    };
  } catch {
    return { systemPrompt: undefined, tools: undefined };
  }
}

function loadSubagentPrompt(role: string, wikiRoot?: string): string | undefined {
  const repoRoot = getRepoRoot();
  const agentsDir = join(repoRoot, "agents");
  const filePath = join(agentsDir, `wiki-${role}.md`);
  try {
    const content = readFileSync(filePath, "utf-8");
    const { body } = parseFrontmatter(content);
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
    const { role, appendSystemPrompt: extraPrompts, allowedTools } = options ?? {};
    const isMain = !role;

    const wikiSlug = slugify(wikiRoot.split("/").pop() || "wiki");
    const sessionDir = getSessionDir(wikiSlug);
    const sessionManager = SessionManager.create(wikiRoot, sessionDir);

    // 主 agent 从 dispatcher/prompt.md frontmatter 读取工具配置
    const mainConfig = isMain ? loadMainAgentConfig() : null;

    // 工具列表来源优先级：CLI allowedTools > 主 agent frontmatter > undefined
    const toolNames = allowedTools ?? mainConfig?.tools;

    const svc = await createAgentSessionServices({
      cwd: wikiRoot,
      agentDir: this.agentDir,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,

        ...(extraPrompts && extraPrompts.length > 0 && {
          appendSystemPrompt: extraPrompts,
        }),

        // 主 agent：加载 dispatcher prompt（去掉 frontmatter）
        ...(mainConfig?.systemPrompt ? { systemPrompt: mainConfig.systemPrompt } : {}),

        ...(role && {
          systemPrompt: loadSubagentPrompt(role, wikiRoot),
        }),
      },
    });

    if (!this.cachedModels) {
      this.cachedModels = svc.modelRegistry.getAvailable().map((m: Model<any>) => ({
        id: m.id,
        provider: m.provider,
        contextWindow: m.contextWindow,
      }));
    }

    this.probeContextWindows(svc);

    const runtime = await createAgentSessionRuntime(
      async (opts: Parameters<CreateAgentSessionRuntimeFactory>[0]) => {
        const resolved = resolveToolConfig(toolNames, wikiRoot);

        const toolOpts: {
          tools?: string[];
          customTools?: ToolDefinition[];
          noTools?: "builtin";
        } = {
          ...(resolved.builtin ? { tools: resolved.builtin } : {}),
          ...(resolved.custom ? { customTools: resolved.custom } : {}),
          ...(resolved.noBuiltin ? { noTools: "builtin" as const } : {}),
        };

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

  private async probeContextWindows(svc: AgentSessionServices): Promise<void> {
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
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(1000) });
        if (!response.ok) continue;
        const data = (await response.json()) as { data?: Array<{ id: string; meta?: { context_length?: number }; context_window?: number }> };
        const modelList = data?.data ?? [];
        for (const entry of modelList) {
          const ctxLen = entry?.meta?.context_length ?? entry?.context_window;
          if (!ctxLen) continue;
          const match = list.find((m: Model<any>) => m.id === entry.id);
          if (match && (!match.contextWindow || match.contextWindow === DEFAULT_CTX)) {
            (match as Model<any> & { contextWindow: number }).contextWindow = ctxLen;
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
