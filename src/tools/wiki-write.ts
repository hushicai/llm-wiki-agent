// Wiki write tool — ToolDefinition for pi-coding-agent
// Automatically manages frontmatter timestamps, index.md, and log.md
// Also checks for duplicate pages before writing
import { writeFile, mkdir, readFile, appendFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, basename } from "path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
  parseFrontmatter,
  formatFrontmatter,
  mergeFrontmatter,
  stripFrontmatter,
  type WikiFrontmatter,
} from "../core/frontmatter.js";

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Extract a page title from frontmatter or filename.
 */
function pageTitle(
  frontmatter: WikiFrontmatter | null,
  filePath: string,
): string {
  if (frontmatter?.title) return frontmatter.title;
  return basename(filePath, ".md")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Slugify a string for filename comparison.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Check for duplicate pages by comparing titles against existing pages.
 * Returns a list of similar page paths, or empty array if no duplicates found.
 */
async function findDuplicatePages(
  wikiRoot: string,
  newTitle: string,
  newFilePath: string,
): Promise<string[]> {
  const wikiDir = join(wikiRoot, "wiki");
  if (!existsSync(wikiDir)) return [];

  const duplicates: string[] = [];
  const newSlug = slugify(newTitle);
  const newBasename = basename(newFilePath, ".md");
  const newBaseSlug = slugify(newBasename);

  try {
    const entries = await readdir(wikiDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      if (entry === basename(newFilePath)) continue; // same file, skip

      // Check filename slug match
      const entrySlug = slugify(entry.replace(/\.md$/, ""));
      if (entrySlug === newSlug || entrySlug === newBaseSlug) {
        duplicates.push(entry);
        continue;
      }

      // Read frontmatter to compare titles
      try {
        const content = await readFile(join(wikiDir, entry), "utf-8");
        const parsed = parseFrontmatter(content);
        if (parsed?.frontmatter?.title) {
          const existingTitle = parsed.frontmatter.title;
          // Check if one title contains the other (semantic overlap)
          if (
            existingTitle.includes(newTitle) ||
            newTitle.includes(existingTitle)
          ) {
            duplicates.push(entry);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // wiki dir doesn't exist yet
  }

  return duplicates;
}

/**
 * Add a link entry to index.md under ## Pages section.
 */
async function addToIndex(
  wikiRoot: string,
  title: string,
  filePath: string,
): Promise<void> {
  const indexPath = join(wikiRoot, "index.md");
  if (!existsSync(indexPath)) return;

  const link = `- [[${title}]]`;
  const indexContent = await readFile(indexPath, "utf-8");

  // Don't add duplicate
  if (indexContent.includes(link)) return;

  // Append under ## Pages section
  const pagesMarker = "## Pages";
  const pagesIdx = indexContent.indexOf(pagesMarker);
  if (pagesIdx === -1) {
    // No ## Pages section, append at end
    await appendFile(indexPath, `\n${link}\n`);
  } else {
    // Find the end of the ## Pages section (next ## or end of file)
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
}

/**
 * Append an operation to log.md.
 */
async function appendToLog(
  wikiRoot: string,
  operation: string,
  path: string,
): Promise<void> {
  const logPath = join(wikiRoot, "log.md");
  const timestamp = nowISO();
  const entry = `- ${timestamp}: ${operation} ${path}\n`;

  if (!existsSync(logPath)) {
    await writeFile(logPath, `# Wiki Operation Log\n\n${entry}`);
  } else {
    await appendFile(logPath, entry);
  }
}

export function createWikiWriteTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_write",
    label: "Write Wiki Page",
    description:
      "Create or update a wiki page. Automatically manages frontmatter timestamps, index.md entries, and log.md. "
      + "The path is relative to the wiki/ directory (e.g. 'react.md', 'concepts/transformer.md'). "
      + "All pages are stored under wiki/. Do NOT prefix with 'wiki/'.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Page path relative to wiki/ directory (e.g. 'react.md', 'concepts/transformer.md')",
        },
        content: {
          type: "string",
          description:
            "Markdown content with optional YAML frontmatter (e.g. '---\\ntitle: React\\n---\\nContent')",
        },
        mode: {
          type: "string",
          enum: ["create", "update"],
          description:
            "create: fail if exists, update: overwrite (default: auto-detect)",
        },
      },
      required: ["path", "content"],
    },
    execute: async (toolCallId: string, params: any) => {
      // Ensure all pages go under wiki/ directory
      const safePath = params.path.startsWith("wiki/")
        ? params.path
        : `wiki/${params.path}`;
      const fullPath = join(wikiRoot, safePath);

      // mode=create: fail if file exists
      if (params.mode === "create" && existsSync(fullPath)) {
        return { content: [{ type: "text", text: `Error: File already exists: ${params.path}` }] };
      }

      const isUpdate =
        params.mode === "update" || (params.mode !== "create" && existsSync(fullPath));

      // Parse frontmatter from the provided content
      const parsed = parseFrontmatter(params.content);
      const userFm = parsed?.frontmatter ?? null;
      const bodyContent = parsed ? parsed.content : params.content;

      // Build merged frontmatter
      const today = todayISO();
      let mergedFm: WikiFrontmatter;

      if (isUpdate) {
        // Read existing file to preserve old frontmatter
        let existingFm: WikiFrontmatter | null = null;
        try {
          const existingContent = await readFile(fullPath, "utf-8");
          const existingParsed = parseFrontmatter(existingContent);
          existingFm = existingParsed?.frontmatter ?? null;
        } catch {
          // File doesn't exist yet, treat as create
        }

        // Preserve existing created timestamp, update updated timestamp
        mergedFm = mergeFrontmatter(existingFm, {
          updated: today,
        });
        // Apply user frontmatter overrides (title, type, tags, etc.)
        mergedFm = mergeFrontmatter(mergedFm, userFm ?? {});
      } else {
        // New page creation — check for duplicates before writing
        const title = pageTitle(userFm, params.path);
        const duplicates = await findDuplicatePages(wikiRoot, title, params.path);
        if (duplicates.length > 0) {
          const duplicateList = duplicates.map((d) => `\`${d}\``).join(", ");
          return {
            content: [
              {
                type: "text",
                text: `⚠️ 检测到重复页面：${duplicateList}。请先使用 \`wiki_search\` 确认是否需要更新已有页面，而不是创建新页面。`,
              },
            ],
          };
        }

        // New page: set both created and updated
        mergedFm = mergeFrontmatter(userFm, {
          created: today,
          updated: today,
        });
      }

      // Build final content with frontmatter
      const finalContent = `${formatFrontmatter(mergedFm)}${bodyContent}`;

      // Write the file
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, finalContent);

      // Auto-maintain index.md for new pages
      if (!isUpdate) {
        const title = pageTitle(userFm, params.path);
        await addToIndex(wikiRoot, title, params.path);
      }

      // Auto-maintain log.md for all writes
      const operation = isUpdate ? "Updated" : "Created";
      await appendToLog(wikiRoot, operation, safePath);

      return {
        content: [
          { type: "text", text: `Written: ${safePath}` },
        ],
      };
    },
  };
}
