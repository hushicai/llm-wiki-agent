// Wiki read tool — ToolDefinition for pi-coding-agent
// Reads files from wiki/, raw/, and root metadata files only.
// Supports line-based pagination with offset/limit.
import { readFile, realpath } from "fs/promises";
import { join, resolve, relative, sep } from "path";
import { existsSync } from "fs";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

const ALLOWED_PREFIXES = ["wiki/", "raw/"];
const ALLOWED_ROOT_FILES = new Set([
  "AGENTS.md",
  "index.md",
  "log.md",
  ".wikiconfig.yaml",
]);

async function isPathAllowed(wikiRoot: string, requestedPath: string): Promise<boolean> {
  // Resolve wikiRoot itself through symlinks first
  let rootResolved: string;
  try {
    rootResolved = await realpath(wikiRoot);
  } catch {
    rootResolved = resolve(wikiRoot);
  }

  const pathResolved = resolve(rootResolved, requestedPath);

  // Must resolve within wikiRoot (path-boundary-aware)
  if (!pathResolved.startsWith(rootResolved + sep)) {
    // Also allow exact match for root itself (for root metadata files)
    if (pathResolved !== rootResolved) return false;
  }

  // Resolve symlinks to prevent traversal via symlinks
  let realPath: string;
  try {
    realPath = await realpath(pathResolved);
  } catch {
    realPath = pathResolved;
  }

  // Re-check containment after symlink resolution
  if (!realPath.startsWith(rootResolved + sep) && realPath !== rootResolved) return false;

  // Compute relative path for allowlist check
  const relPath = relative(rootResolved, realPath);
  if (ALLOWED_ROOT_FILES.has(relPath)) return true;

  for (const prefix of ALLOWED_PREFIXES) {
    if (relPath.startsWith(prefix)) return true;
  }

  return false;
}

export function createWikiReadTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_read",
    label: "Read Wiki File",
    description:
      "Read a file from the wiki. Supports wiki/ pages, raw/ sources, and root metadata files (AGENTS.md, index.md, log.md, .wikiconfig.yaml). "
      + "Use this instead of bash/read_file. Supports line-based pagination with offset and limit.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "File path relative to wiki root (e.g. 'wiki/react.md', 'raw/jys.txt', 'index.md')",
        },
        offset: {
          type: "number",
          description: "Starting line number (1-indexed, default: 1)",
        },
        limit: {
          type: "number",
          description: "Max lines to return (default: 500, max: 2000)",
        },
      },
      required: ["path"],
    },
    execute: async (toolCallId: string, params: any) => {
      if (!(await isPathAllowed(wikiRoot, params.path))) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Access denied. Path must be under wiki/, raw/, or a root metadata file.`,
            },
          ],
        };
      }

      const fullPath = resolve(wikiRoot, params.path);
      if (!existsSync(fullPath)) {
        return {
          content: [{ type: "text", text: `Error: File not found: ${params.path}` }],
        };
      }

      try {
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const start = Math.max(0, (params.offset || 1) - 1);
        const maxLines = Math.min(params.limit || 500, 2000);
        const end = Math.min(lines.length, start + maxLines);
        const selected = lines.slice(start, end);

        const result = selected.map((line, i) => `${start + i + 1}|${line}`).join("\n");
        const total = lines.length;
        const summary =
          total > maxLines
            ? `---\nShowing lines ${start + 1}-${end} of ${total} (${total - end} more lines). Use offset/limit to paginate.\n`
            : `---\n${total} lines total.\n`;

        return { content: [{ type: "text", text: summary + result }] };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error reading file: ${err.message}` }],
        };
      }
    },
  };
}
