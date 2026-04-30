// Wiki tools registration — ToolDefinition array
// NOTE: Tool registration temporarily disabled for skills-based v1.
// Uncomment when switching back to tool-based implementation.
// import { createWikiSearchTool } from "./wiki-search.js";
// import { createWikiWriteTool } from "./wiki-write.js";
// import { createWikiLintTool } from "./wiki-lint.js";
// import { createWikiReadTool } from "./wiki-read.js";
// import { createWikiListTool } from "./wiki-list.js";
// import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

// export function createWikiTools(opts: { wikiRoot: string }): ToolDefinition[] {
//   return [
//     createWikiReadTool(opts.wikiRoot),
//     createWikiWriteTool(opts.wikiRoot),
//     createWikiSearchTool(opts.wikiRoot),
//     createWikiListTool(opts.wikiRoot),
//     createWikiLintTool(opts.wikiRoot),
//   ];
// }

// Skills-based v1: wiki-ingest, wiki-query, wiki-lint loaded from ~/.llm-wiki-agent/skills/
export function createWikiTools(_opts: { wikiRoot: string }): [] {
  return [];
}
