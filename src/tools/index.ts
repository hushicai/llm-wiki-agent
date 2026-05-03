// src/tools/index.ts — Custom tool registry for llm-wiki-agent
// All custom tool factories are registered here. The set of tool names
// is derived automatically from the registry keys, so adding a new tool
// means just adding one more entry.
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { createSubagentTool } from "./subagent.js";

export type ToolFactory = (wikiRoot: string) => ToolDefinition;

/**
 * Registry of custom tool factories.
 * Key = tool name (used in allowedTools, passed via `tools` config).
 * Value = factory function called with wikiRoot at session creation time.
 */
export const customToolFactories: Record<string, ToolFactory> = {
  subagent: createSubagentTool,
};
