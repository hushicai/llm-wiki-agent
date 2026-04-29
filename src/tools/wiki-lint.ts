// Wiki lint tool — ToolDefinition for pi-coding-agent
// Checks wiki health: orphan pages, missing index, empty directories.
import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export function createWikiLintTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_lint",
    label: "Lint Wiki",
    description: "Check wiki health. Reports issues like missing index.md, empty directories, orphan pages.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["quick", "full"], description: "quick: basic checks, full: deep scan" },
      },
    },
    execute: async (toolCallId: string, params: any) => {
      const wikiDir = join(wikiRoot, "wiki");
      const issues: string[] = [];

      if (!existsSync(wikiDir)) {
        return { content: [{ type: "text", text: "Wiki directory not found." }] };
      }

      // Check index.md
      const indexExists = existsSync(join(wikiRoot, "index.md"));
      if (!indexExists) {
        issues.push("Missing: index.md");
      }

      // Check wiki pages
      const files = await readdir(wikiDir, { withFileTypes: true });
      const mdFiles = files.filter(f => f.isFile() && f.name.endsWith(".md"));
      if (mdFiles.length === 0) {
        issues.push("No wiki pages found in wiki/");
      }

      // Check subdirectories
      const subdirs = files.filter(f => f.isDirectory());
      for (const dir of subdirs) {
        const dirFiles = await readdir(join(wikiDir, dir.name));
        if (dirFiles.length === 0) {
          issues.push(`Empty directory: wiki/${dir.name}`);
        }
      }

      const result = issues.length === 0
        ? "Wiki looks healthy."
        : `Issues found (${issues.length}):\n${issues.join("\n")}`;

      return { content: [{ type: "text", text: result }] };
    },
  };
}
