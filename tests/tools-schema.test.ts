import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Type } from "typebox";
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

  test("all tools have TypeBox schema parameters", () => {
    const tools = createWikiTools({ wikiRoot, version: "v1" });
    
    for (const tool of tools) {
      // pi-agent-core requires parameters to have $id for TypeBox
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.parameters).toBe("object");
      expect(tool.parameters.type).toBe("object");  // TypeBox object schema
    }
  });

  test("wiki_read has required fields", () => {
    const tools = createWikiTools({ wikiRoot, version: "v1" });
    const tool = tools.find(t => t.name === "wiki_read")!;
    
    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  test("wiki_write has required fields", () => {
    const tools = createWikiTools({ wikiRoot, version: "v1" });
    const tool = tools.find(t => t.name === "wiki_write")!;
    
    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  test("wiki_search has required fields", () => {
    const tools = createWikiTools({ wikiRoot, version: "v1" });
    const tool = tools.find(t => t.name === "wiki_search")!;
    
    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  test("wiki_list has required fields", () => {
    const tools = createWikiTools({ wikiRoot, version: "v1" });
    const tool = tools.find(t => t.name === "wiki_list")!;
    
    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  test("wiki_ingest has required fields", () => {
    const tools = createWikiTools({ wikiRoot, version: "v1" });
    const tool = tools.find(t => t.name === "wiki_ingest")!;
    
    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  test("wiki_lint has required fields", () => {
    const tools = createWikiTools({ wikiRoot, version: "v1" });
    const tool = tools.find(t => t.name === "wiki_lint")!;
    
    expect(tool.label).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });
});
