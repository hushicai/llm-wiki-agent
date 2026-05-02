// Configuration paths for llm-wiki-agent
// Config directory: ~/.llm-wiki-agent/ (independent from ~/.pi/agent/)
import { join } from "path";
import { homedir } from "os";

export const AGENT_DIR = join(homedir(), ".llm-wiki-agent", 'agent');

export function getAgentDir(): string {
  return AGENT_DIR;
}

export function getSessionDir(wikiSlug: string): string {
  return join(AGENT_DIR, "sessions", wikiSlug);
}

export function getModelsPath(): string {
  return join(AGENT_DIR, "models.json");
}

export function getAuthPath(): string {
  return join(AGENT_DIR, "auth.json");
}

export function getSettingsPath(): string {
  return join(AGENT_DIR, "settings.json");
}

export function slugify(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}
