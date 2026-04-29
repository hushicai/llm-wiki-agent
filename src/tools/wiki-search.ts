// Wiki search tool — ToolDefinition for pi-coding-agent
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export function createWikiSearchTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_search",
    label: "Search Wiki",
    description: "Search wiki content by keyword. Returns matching pages with line excerpts.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword" },
        scope: { type: "string", enum: ["wiki", "raw", "all"], description: "Search scope" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
    execute: async (toolCallId: string, params: any) => {
      const dirs: string[] = [];
      if (params.scope !== "raw") dirs.push(join(wikiRoot, "wiki"));
      if (params.scope === "raw" || params.scope === "all") dirs.push(join(wikiRoot, "raw"));
      const matches: string[] = [];
      const q = params.query.toLowerCase();
      const limit = params.limit || 10;

      for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        try {
          const files = await readdir(dir, { withFileTypes: true });
          for (const entry of files) {
            if (matches.length >= limit) break;
            if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
            try {
              const content = await readFile(join(dir, entry.name), "utf-8");
              if (!content.toLowerCase().includes(q)) continue;
              const line = content.split("\n").find(l => l.toLowerCase().includes(q));
              if (line) matches.push(`${entry.name}: ${line.slice(0, 80)}`);
            } catch {}
          }
        } catch {}
      }

      return {
        content: [{ type: "text", text: matches.length ? matches.join("\n") : "No matches found." }],
      };
    },
  };
}
