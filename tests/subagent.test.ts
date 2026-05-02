// src/tools/subagent.ts — loadAgentsFromDir tests
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadAgentsFromDir, discoverAgents, agentNameToRole } from "../src/tools/subagent.js";

let tmpDir: string;

describe("loadAgentsFromDir", () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "subagent-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array for non-existent directory", () => {
    const agents = loadAgentsFromDir(join(tmpDir, "nonexistent"));
    expect(agents).toEqual([]);
  });

  test("returns empty array for empty directory", () => {
    const emptyDir = join(tmpDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    const agents = loadAgentsFromDir(emptyDir);
    expect(agents).toEqual([]);
  });

  test("ignores non-.md files", () => {
    const dir = join(tmpDir, "no-md");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "readme.txt"), "not a markdown file");
    writeFileSync(join(dir, "config.json"), "{}");
    const agents = loadAgentsFromDir(dir);
    expect(agents).toEqual([]);
  });

  test("skips .md files without frontmatter", () => {
    const dir = join(tmpDir, "no-frontmatter");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plain.md"), "# Just a heading\n\nNo frontmatter here.");
    const agents = loadAgentsFromDir(dir);
    expect(agents).toEqual([]);
  });

  test("skips .md files without required name/description", () => {
    const dir = join(tmpDir, "incomplete");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "incomplete.md"), "---\ntitle: Incomplete\n---\nBody");
    const agents = loadAgentsFromDir(dir);
    expect(agents).toEqual([]);
  });

  test("parses agent from valid .md file", () => {
    const dir = join(tmpDir, "valid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "wiki-ingest.md"),
      `---
name: wiki-ingest
description: Ingest content into wiki
---
Prompt body here`,
    );
    const agents = loadAgentsFromDir(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("wiki-ingest");
    expect(agents[0].description).toBe("Ingest content into wiki");
    expect(agents[0].systemPrompt.trim()).toBe("Prompt body here");
    expect(agents[0].tools).toBeUndefined();
    expect(agents[0].model).toBeUndefined();
  });

  test("parses tools and model fields", () => {
    const dir = join(tmpDir, "with-tools");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "wiki-query.md"),
      `---
name: wiki-query
description: Query wiki content
tools: read, search
model: gpt-4
---
Query instructions`,
    );
    const agents = loadAgentsFromDir(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].tools).toEqual(["read", "search"]);
    expect(agents[0].model).toBe("gpt-4");
  });

  test("loads multiple valid agents from directory", () => {
    const dir = join(tmpDir, "multiple");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "agent-a.md"),
      `---
name: agent-a
description: First agent
---
Body A`,
    );
    writeFileSync(
      join(dir, "agent-b.md"),
      `---
name: agent-b
description: Second agent
---
Body B`,
    );
    writeFileSync(
      join(dir, "invalid.txt"),
      "this should be ignored",
    );
    const agents = loadAgentsFromDir(dir);
    expect(agents).toHaveLength(2);
    expect(agents.map((a: any) => a.name).sort()).toEqual(["agent-a", "agent-b"]);
  });
});

describe("agentNameToRole", () => {
  test("strips wiki- prefix", () => {
    expect(agentNameToRole("wiki-ingest")).toBe("ingest");
    expect(agentNameToRole("wiki-query")).toBe("query");
    expect(agentNameToRole("wiki-lint")).toBe("lint");
  });

  test("keeps name as-is when no wiki- prefix", () => {
    expect(agentNameToRole("custom-agent")).toBe("custom-agent");
    expect(agentNameToRole("ingest")).toBe("ingest");
  });

  test("handles empty string", () => {
    expect(agentNameToRole("")).toBe("");
  });
});

describe("discoverAgents", () => {
  test("returns agents from repo agents/ directory", () => {
    const result = discoverAgents(process.cwd());
    expect(result.agents).toBeDefined();
    expect(Array.isArray(result.agents)).toBe(true);
    // The real agents/ dir should have at least one agent
    expect(result.agents.length).toBeGreaterThan(0);
    // Each agent should have required fields
    for (const agent of result.agents) {
      expect(agent.name).toBeDefined();
      expect(agent.description).toBeDefined();
    }
  });

  test("agents have proper structure", () => {
    const result = discoverAgents(process.cwd());
    for (const agent of result.agents) {
      expect(typeof agent.name).toBe("string");
      expect(typeof agent.description).toBe("string");
      expect(typeof agent.systemPrompt).toBe("string");
      expect(agent.filePath).toContain("agents/");
    }
  });
});
