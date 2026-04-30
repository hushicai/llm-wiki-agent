// Frontmatter utilities — parse, format, merge YAML frontmatter for wiki pages
import { stringify, parse } from "yaml";

export interface WikiFrontmatter {
  title?: string;
  type?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  [key: string]: unknown;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n?---\n?/;

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { frontmatter, content } or null if no frontmatter found.
 */
export function parseFrontmatter(
  content: string,
): { frontmatter: WikiFrontmatter; content: string } | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  try {
    const frontmatter = (parse(match[1]) ?? {}) as WikiFrontmatter;
    return { frontmatter, content: content.slice(match[0].length) };
  } catch {
    return null;
  }
}

/**
 * Strip frontmatter from content, returning only the body.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "");
}

/**
 * Format a frontmatter object as a YAML frontmatter string.
 */
export function formatFrontmatter(fm: WikiFrontmatter): string {
  return `---\n${stringify(fm).trim()}\n---\n`;
}

/**
 * Merge overrides into existing frontmatter (or create from scratch).
 */
export function mergeFrontmatter(
  existing: WikiFrontmatter | null,
  overrides: Partial<WikiFrontmatter>,
): WikiFrontmatter {
  return { ...(existing ?? {}), ...overrides } as WikiFrontmatter;
}
