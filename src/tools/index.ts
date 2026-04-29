// Wiki tools registration — ToolDefinition array
import { createWikiReadTool } from "./wiki-read.js";
import { createWikiWriteTool } from "./wiki-write.js";
import { createWikiSearchTool } from "./wiki-search.js";
import { createWikiListTool } from "./wiki-list.js";
import { createWikiIngestTool } from "./wiki-ingest.js";
import { createWikiLintTool } from "./wiki-lint.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export function createWikiTools(opts: { wikiRoot: string }): ToolDefinition[] {
  return [
    createWikiReadTool(opts.wikiRoot),
    createWikiWriteTool(opts.wikiRoot),
    createWikiSearchTool(opts.wikiRoot),
    createWikiListTool(opts.wikiRoot),
    createWikiIngestTool(opts.wikiRoot),
    createWikiLintTool(opts.wikiRoot),
  ];
}
