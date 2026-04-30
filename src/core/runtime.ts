// Agent Runtime — wraps pi-coding-agent's createAgentSession
import {
  createAgentSession,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { getAgentDir, getSessionDir, slugify } from "./config.js";
import { join } from "path";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

export interface WikiSessionOptions {
  wikiRoot: string;
}

/**
 * Probe context window from /v1/models endpoint for custom models
 * that don't have contextWindow set in models.json.
 * Results are cached to avoid repeated requests.
 */
const probedContexts = new Map<string, number>();

async function probeContextWindows(svc: Awaited<ReturnType<typeof createAgentSessionServices>>, fallback: number): Promise<void> {
  const registry = svc.modelRegistry;
  // Only probe custom models with auth configured
  const models = registry.getAvailable();
  // Only probe models with default contextWindow (128000)
  const DEFAULT_CTX = 128000;
  const providerModels = new Map<string, typeof models>();
  for (const m of models) {
    if (m.contextWindow && m.contextWindow !== DEFAULT_CTX) continue; // already set explicitly
    const list = providerModels.get(m.provider) ?? [];
    list.push(m);
    providerModels.set(m.provider, list);
  }

  const entries = Array.from(providerModels.entries());
  for (const [provider, providerModelList] of entries) {
    if (providerModelList.length === 0) continue;

    // Check cache first
    if (probedContexts.has(provider)) {
      const cached = probedContexts.get(provider)!;
      for (const m of providerModelList) {
        (m as any).contextWindow = cached;
      }
      continue;
    }

    // Get baseUrl and apiKey from the first model
    const baseUrl = providerModelList[0].baseUrl;
    if (!baseUrl) continue;

    // Skip providers without configured auth (would timeout)
    const auth = await registry.getApiKeyAndHeaders(providerModelList[0]);
    if (!auth.ok) continue;

    try {
      const url = baseUrl.replace(/\/+$/, "") + "/models";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (auth.ok && auth.apiKey) {
        headers["Authorization"] = `Bearer ${auth.apiKey}`;
      }

      const response = await fetch(url, { headers, signal: AbortSignal.timeout(1000) });
      if (!response.ok) continue;

      const data = await response.json() as any;
      const modelList: any[] = data?.data ?? [];
      if (modelList.length === 0) continue;

      // Build a lookup: modelId → context_length
      for (const entry of modelList) {
        const ctxLen = entry?.meta?.context_length ?? entry?.context_window ?? entry?.max_context_window;
        if (!ctxLen) continue;

        const match = providerModelList.find(m => m.id === entry.id);
        if (match && (!match.contextWindow || match.contextWindow === DEFAULT_CTX)) {
          (match as any).contextWindow = ctxLen;
          probedContexts.set(provider, ctxLen);
        }
      }
    } catch {
      // Timeout or network error — fallback to default
      for (const m of providerModelList) {
        if (!m.contextWindow) (m as any).contextWindow = fallback;
      }
    }
  }
}

/**
 * Create a wiki AgentSessionRuntime bound to a single wiki root.
 * - Skills-based: wiki-ingest, wiki-query, wiki-lint loaded from ~/.llm-wiki-agent/skills/
 * - Sessions stored in ~/.llm-wiki-agent/sessions/<wiki-slug>/
 * - Uses custom models from ~/.llm-wiki-agent/models.json
 * - External skills (~/.agents/skills/) disabled via noSkills
 * - Auto-probes context window from /v1/models for custom models
 */
export async function createWikiSession(options: WikiSessionOptions) {
  const { wikiRoot } = options;
  const wikiSlug = slugify(wikiRoot.split("/").pop() || "wiki");
  const agentDir = getAgentDir();
  const sessionDir = getSessionDir(wikiSlug);

  const sessionManager = SessionManager.create(wikiRoot, sessionDir);

  // Load system prompt from template
  const promptPath = new URL("../templates/system-prompt-template.md", import.meta.url).pathname;
  const promptContent = await readFile(promptPath, "utf-8");
  const appendSystemPrompt = ["", ...promptContent.split("\n"), ""];

  // Create runtime services with noSkills to block ~/.agents/skills/
  const svc = await createAgentSessionServices({
    cwd: wikiRoot,
    agentDir,
    resourceLoaderOptions: {
      noSkills: true,
      appendSystemPrompt,
      ...(existsSync(join(agentDir, "skills")) && {
        additionalSkillPaths: [join(agentDir, "skills")],
      }),
    },
  });

  // Reset custom model context windows to 0 (unknown).
  // Async probe will update them; if probe fails, fallback to 128k.
  const DEFAULT_FALLBACK = 128000;
  for (const m of svc.modelRegistry.getAvailable()) {
    if (!m.contextWindow || m.contextWindow === DEFAULT_FALLBACK) {
      (m as any).contextWindow = 0;
    }
  }

  // Fire-and-forget: probe context window in background, update model when done
  probeContextWindows(svc, DEFAULT_FALLBACK).catch(() => {});

  // Create the runtime, passing the resourceLoader from services
  const runtime = await createAgentSessionRuntime(
    async (opts) => {
      const result = await createAgentSession({
        ...opts,
        // Skills-based: allow built-in tools
        agentDir,
        resourceLoader: svc.resourceLoader,
        modelRegistry: svc.modelRegistry,
        // Skills-based: no custom tools
        sessionManager,
      });
      return {
        ...result,
        services: svc,
        diagnostics: svc.diagnostics,
      };
    },
    { cwd: wikiRoot, agentDir, sessionManager }
  );

  return runtime;
}
