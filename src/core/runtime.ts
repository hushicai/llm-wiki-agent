// src/core/runtime.ts — Thin wrapper for createWikiSession (test/benchmark entry)
import { WikiAgent } from "./agent.js";
import { createWikiTools } from "../tools/index.js";

export interface WikiSessionOptions {
  wikiRoot: string;
}

/**
 * Create a wiki AgentSessionRuntime bound to a single wiki root.
 * Thin wrapper around WikiAgent.createSession().
 * Used by tests and benchmarks.
 */
export async function createWikiSession(options: WikiSessionOptions) {
  const { wikiRoot } = options;
  const agent = new WikiAgent();
  const runtime = await agent.createSession(wikiRoot, {
    tools: createWikiTools(wikiRoot),
  });
  return runtime;
}
