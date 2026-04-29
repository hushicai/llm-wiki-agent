// Wiki ingest tool — ToolDefinition for pi-coding-agent
// Reads raw source and returns content to LLM for processing.
// LLM decides how to create/update wiki pages from the content.
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export function createWikiIngestTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_ingest",
    label: "Ingest Source",
    description: "Read a raw source file and return its content. The LLM should then create/update wiki pages based on the content.",
    parameters: {
      type: "object",
      properties: {
        source_path: { type: "string", description: "Path relative to raw/" },
      },
      required: ["source_path"],
    },
    execute: async (toolCallId: string, params: any) => {
      const sourcePath = join(wikiRoot, "raw", params.source_path);
      if (!existsSync(sourcePath)) {
        return { content: [{ type: "text", text: `Error: Source not found: ${params.source_path}` }] };
      }
      const content = await readFile(sourcePath, "utf-8");
      return { content: [{ type: "text", text: content }] };
    },
  };
}
