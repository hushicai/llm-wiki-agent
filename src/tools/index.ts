// src/tools/index.ts — unified wiki tool factory
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { createWikiDelegateTaskTool } from "./delegate-task.js";

export function createWikiTools(wikiRoot: string): (string | ToolDefinition<any>)[] {
  return [createWikiDelegateTaskTool(wikiRoot)];
}
