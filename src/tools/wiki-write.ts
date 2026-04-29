// Wiki write tool — ToolDefinition for pi-coding-agent
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export function createWikiWriteTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_write",
    label: "Write Wiki Page",
    description: "Create or update a wiki page under the wiki/ directory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Page path relative to wiki/" },
        content: { type: "string", description: "Markdown content" },
        mode: { type: "string", enum: ["create", "update"], description: "create: fail if exists, update: overwrite" },
      },
      required: ["path", "content"],
    },
    execute: async (toolCallId: string, params: any) => {
      const fullPath = join(wikiRoot, "wiki", params.path);
      if (params.mode === "create" && existsSync(fullPath)) {
        return { content: [{ type: "text", text: `Error: File already exists: ${params.path}` }] };
      }
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, params.content);
      return { content: [{ type: "text", text: `Written: ${params.path}` }] };
    },
  };
}
