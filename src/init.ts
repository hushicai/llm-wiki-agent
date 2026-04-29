// Wiki directory initialization
// Creates the flat directory structure per design doc
import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { stringify, parse } from "yaml";

export interface WikiConfig {
  name: string;
  version: "v1" | "v2";
  description: string;
  created: string;
}

const AGENTS_MD_TEMPLATE = `# Wiki Agent — {wiki_name}

## Role
You are a Wiki knowledge management agent. Your role is to help users build, organize, and query their personal knowledge wiki.

## Capabilities
- **Read**: Access existing wiki pages and raw sources
- **Write**: Create and update wiki pages with proper frontmatter
- **Search**: Find information across wiki content
- **Ingest**: Process raw sources into wiki entries
- **Lint**: Check wiki health and consistency

## Workflow
1. User asks a question or requests an action
2. You use tools to gather information or make changes
3. You explain your reasoning and findings
4. You update the wiki as needed

## Guidelines
- Always cite sources when making claims
- Use proper frontmatter for all wiki pages
- Link related entities and concepts
`;

/**
 * Check if wiki directory exists and is valid
 */
export async function isWikiInitialized(wikiRoot: string): Promise<boolean> {
  const configPath = join(wikiRoot, ".wikiconfig.yaml");
  return existsSync(configPath);
}

/**
 * Initialize a new Wiki directory with flat structure
 */
export async function initWiki(
  wikiRoot: string,
  options: {
    name?: string;
    description?: string;
  } = {}
): Promise<{ success: boolean; path: string }> {
  const { name = "My Wiki", description = "Personal knowledge wiki" } = options;

  if (await isWikiInitialized(wikiRoot)) {
    return { success: false, path: wikiRoot };
  }

  // Create directory structure (flat, per design doc)
  const dirs = [
    wikiRoot,
    join(wikiRoot, "raw"),
    join(wikiRoot, "skills"),
    join(wikiRoot, "entities"),
    join(wikiRoot, "concepts"),
    join(wikiRoot, "pages"),
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  // Write .wikiconfig.yaml
  const config: WikiConfig = {
    name,
    version: "v1",
    description,
    created: new Date().toISOString().split("T")[0],
  };
  await writeFile(join(wikiRoot, ".wikiconfig.yaml"), stringify(config));

  // Write AGENTS.md
  const agentsContent = AGENTS_MD_TEMPLATE.replace("{wiki_name}", name);
  await writeFile(join(wikiRoot, "AGENTS.md"), agentsContent);

  // Write index.md
  await writeFile(
    join(wikiRoot, "index.md"),
    `# ${name}\n\n> ${description}\n\n## Pages\n\n<!-- wiki pages will be listed here -->\n`
  );

  // Write log.md
  await writeFile(
    join(wikiRoot, "log.md"),
    `# Wiki Operation Log\n\n- ${new Date().toISOString()}: Wiki initialized\n`
  );

  return { success: true, path: wikiRoot };
}

/**
 * Load Wiki configuration
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
