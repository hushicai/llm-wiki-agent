// src/prompts/roles.ts — Role prompts loaded from .md files
import { readFileSync } from "fs";

function loadPrompt(filename: string): string {
  return readFileSync(new URL(`./${filename}`, import.meta.url), "utf-8");
}

export const MAIN_ROLE_PROMPT = loadPrompt("main-role.md");
export const INGEST_ROLE_PROMPT = loadPrompt("ingest-role.md");
export const QUERY_ROLE_PROMPT = loadPrompt("query-role.md");
export const LINT_ROLE_PROMPT = loadPrompt("lint-role.md");
