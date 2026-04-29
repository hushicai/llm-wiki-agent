// Wiki list tool — ToolDefinition for pi-coding-agent
import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export function createWikiListTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_list",
    label: "List Wiki",
    description: "List wiki directory structure.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to wiki/ (default: wiki)" },
        format: { type: "string", enum: ["tree", "flat"], description: "Output format" },
      },
    },
    execute: async (toolCallId: string, params: any) => {
      const dir = join(wikiRoot, params.path || "wiki");
      if (!existsSync(dir)) {
        return { content: [{ type: "text", text: "(empty)" }] };
      }
      const files = await readdir(dir);
      const entries = files.filter(f => f.endsWith(".md"));
      const text = entries.map(f => params.format === "tree" ? `  - ${f}` : f).join("\n");
      return { content: [{ type: "text", text: text || "(empty)" }] };
    },
  };
}
