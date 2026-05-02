// src/tools/subagent.ts — loadAgentsFromDir tests
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadAgentsFromDir } from "../src/tools/subagent.js";

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
