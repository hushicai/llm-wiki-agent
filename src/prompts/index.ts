// src/prompts/index.ts — All prompts loaded from .md files
import { readFileSync } from "fs";

function loadPrompt(filename: string): string {
  return readFileSync(new URL(`./${filename}`, import.meta.url), "utf-8");
}

export function loadMainPrompt(): string {
  return loadPrompt("main-prompt.md");
}

export function loadIngestPrompt(): string {
  return loadPrompt("ingest-prompt.md");
}

export function loadQueryPrompt(): string {
  return loadPrompt("query-prompt.md");
}

export function loadLintPrompt(): string {
  return loadPrompt("lint-prompt.md");
}

export function loadSystemPrompt(): string {
  return loadPrompt("system-prompt.md");
}

export function loadWikiSchema(): string {
  return loadPrompt("wiki-schema.md");
}

// Convenience re-exports for existing code
export const MAIN_ROLE_PROMPT = loadMainPrompt();
export const INGEST_ROLE_PROMPT = loadIngestPrompt();
export const QUERY_ROLE_PROMPT = loadQueryPrompt();
export const LINT_ROLE_PROMPT = loadLintPrompt();
