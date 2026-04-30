// Wiki search tool — ToolDefinition for pi-coding-agent
// Searches wiki content using grep and returns full content of matching pages.
// v1: grep-based keyword search. v2: upgrade to hybrid search (BM25 + vector + graph).
import { readFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export function createWikiSearchTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_search",
    label: "Search Wiki",
    description: "Search wiki content by keyword. Uses grep to find matching pages and returns their full content. "
      + "Call this when the user asks a question or wants to find information in the wiki. "
      + "If results aren't relevant, try different keywords.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword or phrase" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
    execute: async (toolCallId: string, params: any) => {
      const wikiDir = join(wikiRoot, "wiki");
      const q = params.query;
      const limit = params.limit || 10;

      // Use grep to find matching files (case-insensitive, recursive, only .md)
      let matches: string[];
      try {
        const output = execSync(
          `grep -ril "${q.replace(/"/g, '\\"')}" "${wikiDir}" --include="*.md"`,
          { encoding: "utf-8", timeout: 10000 }
        );
        matches = output.trim().split("\n").filter(Boolean);
      } catch {
        // grep exits with code 1 when no matches found
        return { content: [{ type: "text", text: "No matches found." }] };
      }

      if (matches.length === 0) {
        return { content: [{ type: "text", text: "No matches found." }] };
      }

      // Read full content of matching files (up to limit)
      const results: string[] = [];
      for (const filePath of matches.slice(0, limit)) {
        try {
          const content = await readFile(filePath, "utf-8");
          // Show relative path from wiki root
          const relPath = filePath.replace(wikiDir + "/", "");
          results.push(`--- ${relPath} ---\n${content}`);
        } catch {
          // Skip unreadable files
        }
      }

      const summary = matches.length > limit
        ? `Found ${matches.length} matches, showing ${limit}:\n\n`
        : `Found ${matches.length} match(es):\n\n`;

      return { content: [{ type: "text", text: summary + results.join("\n\n") }] };
    },
  };
}
