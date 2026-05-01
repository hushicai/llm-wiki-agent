// src/prompts/index.ts — All prompts loaded from .md files
import { readFileSync } from "fs";

function loadPrompt(filename: string): string {
  return readFileSync(new URL(`./${filename}`, import.meta.url), "utf-8");
}

export function loadMainRole(): string {
  return loadPrompt("main-role.md");
}

export function loadIngestRole(): string {
  return loadPrompt("ingest-role.md");
}

export function loadQueryRole(): string {
  return loadPrompt("query-role.md");
}

export function loadLintRole(): string {
  return loadPrompt("lint-role.md");
}

export function loadSystemPrompt(): string {
  return loadPrompt("system-prompt.md");
}

export function loadWikiSchema(): string {
  return loadPrompt("wiki-schema.md");
}

// Convenience re-exports for existing code
export const MAIN_ROLE_PROMPT = loadMainRole();
export const INGEST_ROLE_PROMPT = loadIngestRole();
export const QUERY_ROLE_PROMPT = loadQueryRole();
export const LINT_ROLE_PROMPT = loadLintRole();
