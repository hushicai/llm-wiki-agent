// Agent Runtime — wraps pi-coding-agent's createAgentSession
import {
  createAgentSession,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { createWikiTools } from "./tools/index.js";
import { getAgentDir, getSessionDir, slugify } from "./config.js";

export interface WikiSessionOptions {
  wikiRoot: string;
}

/**
 * Create a wiki AgentSessionRuntime bound to a single wiki root.
 * - Only wiki-specific tools are available (no bash, edit, write, read)
 * - Sessions stored in ~/.llm-wiki-agent/sessions/<wiki-slug>/
 * - Uses custom models from ~/.llm-wiki-agent/models.json
 */
export async function createWikiSession(options: WikiSessionOptions) {
  const { wikiRoot } = options;
  const wikiSlug = slugify(wikiRoot.split("/").pop() || "wiki");
  const agentDir = getAgentDir();
  const sessionDir = getSessionDir(wikiSlug);

  const sessionManager = SessionManager.create(wikiRoot, sessionDir);
  const wikiTools: ToolDefinition[] = createWikiTools({ wikiRoot });
  const wikiToolNames = wikiTools.map(t => t.name);

  // Create runtime services bound to cwd
  const { services, diagnostics } = await createAgentSessionServices({
    cwd: wikiRoot,
    agentDir,
    sessionManager,
  });

  // Create the runtime
  const runtime = await createAgentSessionRuntime(
    async (opts) => {
      const result = await createAgentSession({
        ...opts,
        agentDir,
        tools: wikiToolNames,     // allowlist: only wiki tools
        customTools: wikiTools,    // register wiki tool definitions
        sessionManager,
      });
      return {
        ...result,
        services,
        diagnostics,
      };
    },
    { cwd: wikiRoot, agentDir, sessionManager }
  );

  return runtime;
}
