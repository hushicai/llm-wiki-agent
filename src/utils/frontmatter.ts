// src/utils/frontmatter.ts
// Frontmatter 工具 — 统一 parse、format、merge YAML frontmatter
// 支持两种场景：
//   - Subagent prompt 文件（简单 key:value 元数据）
//   - Wiki 页面 frontmatter（结构化 YAML，tags/categories 等）
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
 * 解析 YAML frontmatter from markdown content。
 * 无 frontmatter 时返回空对象 + 原始内容（不像之前返回 null）。
 * 返回 { frontmatter, body } 以兼容 subagent prompt 使用模式。
 */
export function parseFrontmatter(
  content: string,
): { frontmatter: WikiFrontmatter; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: content };
  try {
    const frontmatter = (parse(match[1]) ?? {}) as WikiFrontmatter;
    return { frontmatter, body: content.slice(match[0].length) };
  } catch {
    return { frontmatter: {}, body: content };
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
