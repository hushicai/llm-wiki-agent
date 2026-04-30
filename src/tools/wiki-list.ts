// Wiki list tool — ToolDefinition for pi-coding-agent
// Lists files and directories in the wiki. Limited to wiki/, raw/, and root.
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

const ALLOWED_DIRS = new Set(["", ".", "wiki", "raw"]);

export function createWikiListTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_list",
    label: "List Wiki Directory",
    description:
      "List files and directories in the wiki. Shows wiki/ pages, raw/ sources, or root directory. "
      + "Use this instead of bash ls. Supports tree and flat formats.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Directory to list. Allowed: '' (root), 'wiki', 'raw' (default: '')",
        },
        format: {
          type: "string",
          enum: ["tree", "flat"],
          description: "Output format (default: tree)",
        },
      },
    },
    execute: async (toolCallId: string, params: any) => {
      const dirPath = params.path || "";
      const format = params.format || "tree";

      if (!ALLOWED_DIRS.has(dirPath)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Access denied. Only root, wiki/, and raw/ directories are listable.`,
            },
          ],
        };
      }

      const fullPath = join(wikiRoot, dirPath);
      if (!existsSync(fullPath)) {
        return {
          content: [{ type: "text", text: `Error: Directory not found: ${dirPath || "(root)"}` }],
        };
      }

      try {
        const entries = await readdir(fullPath, { withFileTypes: true });

        if (format === "flat") {
          const files: string[] = [];
          for (const entry of entries) {
            const entryPath = join(fullPath, entry.name);
            const entryStat = await stat(entryPath);
            const type = entry.isDirectory() ? "dir" : "file";
            const size = entry.isFile() ? ` (${entryStat.size} bytes)` : "";
            files.push(`${type}\t${dirPath ? dirPath + "/" : ""}${entry.name}${size}`);
          }
          return {
            content: [{ type: "text", text: files.sort().join("\n") || "(empty)" }],
          };
        }

        // Tree format
        const lines: string[] = [];
        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < sorted.length; i++) {
          const entry = sorted[i];
          const isLast = i === sorted.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const suffix = entry.isDirectory() ? "/" : "";
          lines.push(`${connector}${entry.name}${suffix}`);
        }

        const header = dirPath ? `${dirPath}/` : "wiki-root/";
        return {
          content: [{ type: "text", text: `${header}\n${lines.join("\n") || "(empty)"}` }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error listing directory: ${err.message}` }],
        };
      }
    },
  };
}
