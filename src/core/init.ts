// Wiki directory initialization and self-healing
import { writeFile, mkdir, readFile, readdir, copyFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { stringify, parse } from "yaml";
import { getAgentDir } from "./config.js";

export interface WikiConfig {
  name: string;
  version: "v1" | "v2";
  description: string;
  created: string;
}

/**
 * Scan a wiki root for existing content directories (subdirectories that aren't system dirs).
 */
async function getContentDirs(wikiRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(wikiRoot, { withFileTypes: true });
    const systemDirs = new Set([".wiki", "raw", "wiki", ".devops"]);
    return entries
      .filter(e => e.isDirectory() && !systemDirs.has(e.name) && !e.name.startsWith("."))
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

function buildStructureDiagram(dirs: string[]): string {
  if (dirs.length === 0) {
    return `<wiki-root>/
├── index.md            # Page index (auto-maintained)
├── log.md              # Operation log (auto-maintained)
├── raw/                # Source documents (read-only, user places files here)
└── wiki/               # Wiki pages (LLM-managed, flat)`;
  }

  const dirList = dirs.map(d => `├── ${d}/              # Category pages`).join("\n");
  return `<wiki-root>/
├── index.md            # Page index (auto-maintained)
├── log.md              # Operation log (auto-maintained)
├── raw/                # Source documents (read-only, user places files here)
├── wiki/               # Wiki pages (LLM-managed, flat)
${dirList}`;
}

/**
 * Copy skills from project (git repo) to .llm-wiki-agent/skills for project-level isolation.
 * Source: <project>/skills/ (the git repo's skills templates)
 * Target: <wiki-root>/.llm-wiki-agent/skills/
 */
async function copySkillsToWiki(wikiRoot: string): Promise<void> {
  // Project's skills dir (relative to project root, resolved via import.meta)
  const projectRoot = new URL("../..", import.meta.url).pathname;
  const projectSkillsDir = join(projectRoot, "skills");
  const wikiSkillsDir = join(wikiRoot, ".llm-wiki-agent", "skills");

  // Only copy if project has skills
  if (!existsSync(projectSkillsDir)) {
    return;
  }

  // Create target dir
  if (!existsSync(wikiSkillsDir)) {
    mkdirSync(wikiSkillsDir, { recursive: true });
  }

  // Copy entire skills directory recursively
  const { cpSync } = await import("fs");
  cpSync(projectSkillsDir, wikiSkillsDir, { recursive: true });
}

async function generateAgentsMd(wikiRoot: string, wikiName: string): Promise<string> {
  const dirs = await getContentDirs(wikiRoot);
  const structure = buildStructureDiagram(dirs);

  const templatePath = new URL("../templates/wiki-schema-template.md", import.meta.url).pathname;
  const template = await readFile(templatePath, "utf-8");

  return template
    .replace(/\{\{WIKI_NAME\}\}/g, wikiName)
    .replace(/\{\{STRUCTURE\}\}/g, structure);
}

/**
 * Required files and directories for a valid wiki.
 * Used by ensureWiki() for self-healing.
 */
const REQUIRED_DIRS = ["raw", "wiki"];
const REQUIRED_FILES: Array<{ name: string; generate: (wikiRoot: string, name: string) => Promise<void> }> = [
  {
    name: ".wikiconfig.yaml",
    generate: async (wikiRoot, name) => {
      const config: WikiConfig = {
        name: "My Wiki",
        version: "v1",
        description: "Personal knowledge wiki",
        created: new Date().toISOString().split("T")[0],
      };
      await writeFile(join(wikiRoot, name), stringify(config));
    },
  },
  {
    name: "AGENTS.md",
    generate: async (wikiRoot, _name) => {
      const content = await generateAgentsMd(wikiRoot, "My Wiki");
      await writeFile(join(wikiRoot, "AGENTS.md"), content);
    },
  },
  {
    name: "index.md",
    generate: async (wikiRoot, _name) => {
      await writeFile(join(wikiRoot, "index.md"), "# My Wiki\n\n> Personal knowledge wiki\n\n## Pages\n\n<!-- wiki pages will be listed here -->\n");
    },
  },
  {
    name: "log.md",
    generate: async (wikiRoot, _name) => {
      await writeFile(join(wikiRoot, "log.md"), `# Wiki Operation Log\n\n- ${new Date().toISOString()}: Wiki initialized\n`);
    },
  },
];

/**
 * Ensure a wiki directory is complete and valid.
 * Self-healing: creates any missing required files/directories.
 * Returns a report of what was created.
 */
export async function ensureWiki(wikiRoot: string): Promise<{ created: string[] }> {
  const created: string[] = [];

  // Ensure root exists
  if (!existsSync(wikiRoot)) {
    await mkdir(wikiRoot, { recursive: true });
    created.push(wikiRoot);
  }

  // Ensure required directories (only raw/ is mandatory now)
  for (const dir of REQUIRED_DIRS) {
    const dirPath = join(wikiRoot, dir);
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
      created.push(dirPath);
    }
  }

  // Ensure required files
  for (const file of REQUIRED_FILES) {
    const filePath = join(wikiRoot, file.name);
    if (!existsSync(filePath)) {
      await file.generate(wikiRoot, file.name);
      created.push(filePath);
    }
  }

  // Copy skills to wiki-root for project-level isolation
  await copySkillsToWiki(wikiRoot);

  return { created };
}

/**
 * Load Wiki configuration from .wikiconfig.yaml
 */
export async function loadWikiConfig(wikiRoot: string): Promise<WikiConfig | null> {
  const configPath = join(wikiRoot, ".wikiconfig.yaml");
  try {
    const content = await readFile(configPath, "utf-8");
    return parse(content) as WikiConfig;
  } catch {
    return null;
  }
}
