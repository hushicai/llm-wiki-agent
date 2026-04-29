// Wiki read tool — ToolDefinition for pi-coding-agent
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { WikiReadParams } from "../types.js";

export function createWikiReadTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_read",
    label: "Read Wiki Page",
    description: "Read a wiki page or raw source. Supports pagination with offset/limit.",
    parameters: WikiReadParams,
    execute: async (toolCallId: string, params: any) => {
      const baseDir = params.mode === "raw" ? join(wikiRoot, "raw") : join(wikiRoot, "wiki");
      const fullPath = join(baseDir, params.path);

      if (!existsSync(fullPath)) {
        return { content: [{ type: "text", text: `Error: File not found: ${params.path}` }] };
      }

      try {
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const start = Math.max(0, (params.offset || 1) - 1);
        const end = Math.min(lines.length, start + (params.limit || 500));
        return { content: [{ type: "text", text: lines.slice(start, end).join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    },
  };
}
