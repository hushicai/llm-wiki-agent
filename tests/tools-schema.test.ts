import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createWikiTools } from "../src/tools/index.js";

describe("Wiki Tools TypeBox Schema", () => {
  const testDir = join(tmpdir(), "llm-wiki-agent-schema-test");
  const wikiRoot = join(testDir, "wiki");

  beforeAll(async () => {
    await mkdir(join(wikiRoot, "wiki"), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("all 5 custom tools have required fields", () => {
    const tools = createWikiTools({ wikiRoot });
    expect(tools.length).toBe(5);

    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.label).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  test("wiki_search has required fields", () => {
    const tools = createWikiTools({ wikiRoot });
    const tool = tools.find(t => t.name === "wiki_search")!;

    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  test("wiki_write has required fields", () => {
    const tools = createWikiTools({ wikiRoot });
    const tool = tools.find(t => t.name === "wiki_write")!;

    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  test("wiki_lint has required fields", () => {
    const tools = createWikiTools({ wikiRoot });
    const tool = tools.find(t => t.name === "wiki_lint")!;

    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  test("wiki_read has required fields", () => {
    const tools = createWikiTools({ wikiRoot });
    const tool = tools.find(t => t.name === "wiki_read")!;

    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(tool.parameters.properties.path).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  test("wiki_list has required fields", () => {
    const tools = createWikiTools({ wikiRoot });
    const tool = tools.find(t => t.name === "wiki_list")!;

    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });
});
