// Type definitions for llm-wiki-agent

import { Static, Type } from "typebox";

// =====================
// Config Types
// =====================

export interface ModelConfig {
  id: string;
  input?: string[];
}

export interface ProviderConfig {
  base_url: string;
  api: "openai-completions" | "openai-chat" | "anthropic-messages";
  api_key: string;
  models: ModelConfig[];
}

export interface AgentConfig {
  providers: Record<string, ProviderConfig>;
}

// =====================
// Wiki Types
// =====================

export type WikiVersion = "v1" | "v2";

export interface WikiConfig {
  name: string;
  version: WikiVersion;
  schema_version: string;
  description: string;
  created: string;
}

export interface WikiPageFrontmatter {
  title: string;
  type: "entity" | "concept" | "source" | "synthesis";
  tags?: string[];
  confidence?: number; // v2
  created: string;
  updated: string;
  sources?: number[];
  supersedes?: string | null; // v2
}

// =====================
// Tool Parameter Types
// =====================

export const WikiReadParams = Type.Object({
  path: Type.String({ description: "页面路径（相对于 wiki/ 或 raw/）" }),
  offset: Type.Optional(Type.Number({ description: "行号（1-indexed）" })),
  limit: Type.Optional(Type.Number({ description: "最大行数" })),
  mode: Type.Optional(Type.Union([Type.Literal("wiki"), Type.Literal("raw")], { description: "读取 wiki 还是 raw" })),
});

export type WikiReadParamsType = Static<typeof WikiReadParams>;

export const WikiWriteParams = Type.Object({
  path: Type.String({ description: "页面路径" }),
  content: Type.String({ description: "markdown 内容" }),
  frontmatter: Type.Optional(Type.Object({}, { description: "YAML frontmatter" })),
  mode: Type.Optional(Type.Union([Type.Literal("create"), Type.Literal("update")], { description: "创建或更新" })),
});

export type WikiWriteParamsType = Static<typeof WikiWriteParams>;

export const WikiSearchParams = Type.Object({
  query: Type.String({ description: "搜索词" }),
  scope: Type.Optional(Type.Union([Type.Literal("wiki"), Type.Literal("raw"), Type.Literal("all")], { description: "搜索范围" })),
  limit: Type.Optional(Type.Number({ description: "返回结果上限（默认 10）" })),
});

export type WikiSearchParamsType = Static<typeof WikiSearchParams>;

export const WikiListParams = Type.Object({
  path: Type.Optional(Type.String({ description: "目录路径（默认 wiki/）" })),
  format: Type.Optional(Type.Union([Type.Literal("tree"), Type.Literal("index")], { description: "tree 视图或 index.md 内容" })),
  include_raw: Type.Optional(Type.Boolean({ description: "是否包含 raw/ 目录" })),
});

export type WikiListParamsType = Static<typeof WikiListParams>;

export const WikiIngestParams = Type.Object({
  source_path: Type.Optional(Type.String({ description: "raw/ 下的文件路径" })),
  file_path: Type.Optional(Type.String({ description: "直接文件路径（绝对或相对 cwd），覆盖 source_path" })),
  options: Type.Optional(Type.Object({
    force: Type.Optional(Type.Boolean({ description: "强制重新 ingest" })),
    tier: Type.Optional(Type.Union([Type.Literal("working"), Type.Literal("episodic"), Type.Literal("semantic")], { description: "v2: consolidation tier" })),
  })),
});

export type WikiIngestParamsType = Static<typeof WikiIngestParams>;

export const WikiLintParams = Type.Object({
  mode: Type.Optional(Type.Union([Type.Literal("quick"), Type.Literal("full")], { description: "检查模式" })),
  fix: Type.Optional(Type.Boolean({ description: "是否自动修复" })),
});

export type WikiLintParamsType = Static<typeof WikiLintParams>;

// =====================
// Tool Result Types
// =====================

export interface WikiReadResult {
  content: string;
  frontmatter?: WikiPageFrontmatter;
  truncated?: boolean;
}

export interface WikiWriteResult {
  success: boolean;
  path: string;
}

export interface WikiSearchResult {
  matches: Array<{
    path: string;
    line: number;
    snippet: string;
  }>;
}

export interface WikiListResult {
  tree: string;
  entries: string[];
}

export interface WikiIngestResult {
  success: boolean;
  pages_created: string[];
}

export interface WikiLintResult {
  issues: Array<{
    type: "orphan" | "broken_link" | "stale_claim";
    path: string;
    message: string;
  }>;
  fixed?: number;
}

// =====================
// Agent Types
// =====================

export interface WikiToolContext {
  wikiRoot: string;
  version: WikiVersion;
}