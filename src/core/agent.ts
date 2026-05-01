// src/core/agent.ts — WikiAgent: core abstraction for llm-wiki-agent
// Manages config (~/.llm-wiki-agent/), creates sessions, lists models.
import {
  createAgentSession,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { ToolDefinition } from "@mariozechner/pi-agent-core";
import { readFileSync } from "fs";
import { getAgentDir, getSessionDir, slugify } from "./config.js";

export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow?: number;
}

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
        "../prompts/system-prompt.md",
        import.meta.url,
      ).pathname;
      const content = readFileSync(promptPath, "utf-8");
      return ["", ...content.split("\n"), ""];
    } catch {
      return [];
    }
  }

  async createSession(cwd: string, options?: {
    tools?: (string | ToolDefinition)[];
    /** Additional system prompt lines to append after the base system prompt */
    appendSystemPrompt?: string[];
  }) {
    // Filter tools into built-in and custom
    const builtInTools: string[] = [];
    const customToolsList: ToolDefinition[] = [];

    if (options?.tools !== undefined) {
      for (const tool of options.tools) {
        if (typeof tool === "string") {
          builtInTools.push(tool);
        } else {
          customToolsList.push(tool);
        }
      }
    }

    const wikiSlug = slugify(cwd.split("/").pop() || "wiki");
    const sessionDir = getSessionDir(wikiSlug);
    const sessionManager = SessionManager.create(cwd, sessionDir);

    const svc = await createAgentSessionServices({
      cwd,
      agentDir: this.agentDir,
      resourceLoaderOptions: {
        noSkills: true,
        appendSystemPrompt: [
          ...this.systemPromptLines,
          ...(options?.appendSystemPrompt ?? []),
        ],
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
          ...(options?.tools !== undefined && {
            // pi-mono's `tools` parameter is a global allowlist that filters
            // BOTH built-in and custom tools. Include custom tool names too.
            tools: [...builtInTools, ...customToolsList.map((t) => t.name)],
            ...(customToolsList.length > 0 && { customTools: customToolsList }),
          }),
        });
        return { ...result, services: svc, diagnostics: svc.diagnostics };
      },
      { cwd, agentDir: this.agentDir, sessionManager },
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
