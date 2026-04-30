// Wiki lint tool — ToolDefinition for pi-coding-agent
// Checks wiki health: orphan pages, broken wikilinks, missing index, empty directories
// Supports auto-fix with fix: true parameter
import { readdir, readFile, writeFile, mkdir, appendFile } from "fs/promises";
import { join, relative } from "path";
import { existsSync } from "fs";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { parseFrontmatter } from "../core/frontmatter.js";

/** Match [[Page Name]] or [[Page Name|display text]] wikilinks */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Collect all wiki markdown files recursively.
 */
async function collectWikiFiles(
  wikiDir: string,
): Promise<Array<{ path: string; relativePath: string }>> {
  const files: Array<{ path: string; relativePath: string }> = [];

  async function scan(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push({
          path: fullPath,
          relativePath: relative(wikiDir, fullPath),
        });
      }
    }
  }

  await scan(wikiDir);
  return files;
}

/**
 * Read index.md and extract all [[Page Name]] references.
 */
async function getIndexedPages(
  wikiRoot: string,
): Promise<Set<string>> {
  const indexPath = join(wikiRoot, "index.md");
  if (!existsSync(indexPath)) return new Set();

  const content = await readFile(indexPath, "utf-8");
  const pages = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE);
  while ((match = re.exec(content)) !== null) {
    pages.add(match[1].trim());
  }
  return pages;
}

/**
 * Get page titles from all wiki files (from frontmatter or filename).
 */
async function getPageTitles(
  files: Array<{ path: string; relativePath: string }>,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (const file of files) {
    try {
      const content = await readFile(file.path, "utf-8");
      const parsed = parseFrontmatter(content);
      const title = parsed?.frontmatter?.title ?? file.relativePath.replace(/\.md$/, "");
      titles.set(title, file.relativePath);
      // Also store by filename (without .md) for matching
      const filename = file.relativePath.replace(/\.md$/, "");
      titles.set(filename, file.relativePath);
      // Store a humanized version of the filename for matching wikilinks
      const humanized = filename
        .split("/")
        .pop()!
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      if (humanized !== title && humanized !== filename) {
        titles.set(humanized, file.relativePath);
      }
    } catch {
      const filename = file.relativePath.replace(/\.md$/, "");
      titles.set(filename, file.relativePath);
    }
  }
  return titles;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function createWikiLintTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_lint",
    label: "Lint Wiki",
    description:
      "Check wiki health. Reports: missing index.md, empty directories, orphan pages (not in index.md), broken wikilinks ([[Page]] pointing to non-existent files). When fix=true, automatically fixes orphan pages and broken wikilinks.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["quick", "full"],
          description: "quick: basic checks, full: deep scan including wikilinks",
        },
        fix: {
          type: "boolean",
          description: "Auto-fix orphan pages (add to index.md) and broken wikilinks (create stub pages)",
        },
      },
    },
    execute: async (toolCallId: string, params: any) => {
      const wikiDir = join(wikiRoot, "wiki");
      const issues: string[] = [];
      const fixes: string[] = [];
      let fixedCount = 0;
      const isFull = params.mode === "full";

      // Check index.md exists
      const indexExists = existsSync(join(wikiRoot, "index.md"));
      if (!indexExists) {
        issues.push("Missing: index.md");
      }

      // Check wiki directory exists
      if (!existsSync(wikiDir)) {
        return {
          content: [{ type: "text", text: "Wiki directory not found." }],
        };
      }

      // Collect all wiki files
      const files = await collectWikiFiles(wikiDir);

      // Check for empty wiki
      if (files.length === 0) {
        issues.push("No wiki pages found in wiki/");
        return {
          content: [
            {
              type: "text",
              text:
                issues.length === 0
                  ? "Wiki looks healthy."
                  : `Issues found (${issues.length}):\n${issues.join("\n")}`,
            },
          ],
        };
      }

      // Check for empty subdirectories
      const entries = await readdir(wikiDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirFiles = await readdir(join(wikiDir, entry.name));
          if (dirFiles.length === 0) {
            issues.push(`Empty directory: wiki/${entry.name}`);
          }
        }
      }

      // Orphan page detection (pages not in index.md)
      if (indexExists) {
        const indexedPages = await getIndexedPages(wikiRoot);
        const pageTitles = await getPageTitles(files);

        for (const [title, relPath] of pageTitles) {
          // Skip filename-based entries (only check by title from frontmatter)
          if (!title.includes("/")) {
            // Check if this title is referenced in index.md
            let found = false;
            for (const indexed of indexedPages) {
              if (
                indexed.toLowerCase() === title.toLowerCase() ||
                indexed.toLowerCase() === relPath.replace(/\.md$/, "").toLowerCase()
              ) {
                found = true;
                break;
              }
            }
            if (!found) {
              issues.push(`Orphan page: ${relPath} (title: "${title}")`);
              // Auto-fix: add to index.md
              if (params.fix) {
                const indexPath = join(wikiRoot, "index.md");
                const link = `- [[${title}]]`;
                const indexContent = await readFile(indexPath, "utf-8");
                if (!indexContent.includes(link)) {
                  const pagesMarker = "## Pages";
                  const pagesIdx = indexContent.indexOf(pagesMarker);
                  if (pagesIdx === -1) {
                    await appendFile(indexPath, `\n${link}\n`);
                  } else {
                    const afterPages = indexContent.slice(pagesIdx + pagesMarker.length);
                    const nextSection = afterPages.search(/\n## /);
                    const insertPos =
                      nextSection === -1
                        ? indexContent.length
                        : pagesIdx + pagesMarker.length + nextSection;
                    const before = indexContent.slice(0, insertPos);
                    const after = indexContent.slice(insertPos);
                    await writeFile(indexPath, `${before}\n${link}${after}`);
                  }
                  fixes.push(`Added "${title}" to index.md`);
                  fixedCount++;
                }
              }
            }
          }
        }
      }

      // Broken wikilink detection (full mode or default)
      const pageTitlesMap = await getPageTitles(files);
      for (const file of files) {
        try {
          const content = await readFile(file.path, "utf-8");
          const re = new RegExp(WIKILINK_RE);
          let match: RegExpExecArray | null;
          while ((match = re.exec(content)) !== null) {
            const linkTarget = match[1].trim();
            // Skip external links (containing ://)
            if (linkTarget.includes("://")) continue;

            // Check if link target exists as a page title or filename
            const targetLower = linkTarget.toLowerCase();
            let found = false;
            for (const existingTitle of pageTitlesMap.keys()) {
              if (existingTitle.toLowerCase() === targetLower) {
                found = true;
                break;
              }
            }
            if (!found) {
              issues.push(
                `Broken wikilink: "${linkTarget}" in ${file.relativePath}`,
              );
              // Auto-fix: create stub page
              if (params.fix) {
                const stubDir = join(wikiRoot, "wiki");
                if (!existsSync(stubDir)) {
                  await mkdir(stubDir, { recursive: true });
                }
                const stubFilename = linkTarget
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "") + ".md";
                const stubPath = join(stubDir, stubFilename);
                if (!existsSync(stubPath)) {
                  const stubContent = [
                    "---",
                    `title: ${linkTarget}`,
                    "type: page",
                    `created: ${todayISO()}`,
                    "---",
                    "",
                    `# ${linkTarget}`,
                    "",
                    "> Stub page created by wiki_lint fix.",
                    "",
                    "<!-- TODO: Add content -->",
                    "",
                  ].join("\n");
                  await writeFile(stubPath, stubContent);
                  fixes.push(`Stub created: wiki/${stubFilename} for "${linkTarget}"`);
                  fixedCount++;
                }
              }
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      let result: string;
      if (issues.length === 0) {
        result = "Wiki looks healthy.";
      } else {
        result = `Issues found (${issues.length}):\n${issues.join("\n")}`;
        if (fixes.length > 0) {
          result += `\n\nFixed (${fixedCount}):\n${fixes.join("\n")}`;
        }
      }

      return { content: [{ type: "text", text: result }] };
    },
  };
}
