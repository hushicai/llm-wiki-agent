import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createWikiReadTool } from "../src/tools/wiki-read.js";
import { createWikiWriteTool } from "../src/tools/wiki-write.js";
import { createWikiListTool } from "../src/tools/wiki-list.js";
import { createWikiTools } from "../src/tools/index.js";

describe("Wiki Tools", () => {
  const testDir = join(tmpdir(), "llm-wiki-agent-tools-test");
  const wikiRoot = join(testDir, "wiki");

  beforeAll(async () => {
    await mkdir(join(wikiRoot, "wiki"), { recursive: true });
    await mkdir(join(wikiRoot, "raw"), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("wiki_read", () => {
    test("reads existing page", async () => {
      const tool = createWikiReadTool(wikiRoot);
      await writeFile(join(wikiRoot, "wiki/test.md"), "# Test Page\nContent here.");

      const result = await tool.execute("call-1", { path: "test.md" });
      expect(result.content[0].text).toContain("Test Page");
    });

    test("returns error for missing file", async () => {
      const tool = createWikiReadTool(wikiRoot);
      const result = await tool.execute("call-2", { path: "nonexistent.md" });
      expect(result.content[0].text).toContain("Error");
      expect(result.content[0].text).toContain("not found");
    });

    test("supports offset and limit", async () => {
      const tool = createWikiReadTool(wikiRoot);
      const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      await writeFile(join(wikiRoot, "wiki/lines.md"), content);

      const result = await tool.execute("call-3", { path: "lines.md", offset: 2, limit: 2 });
      expect(result.content[0].text).toContain("Line 2");
      expect(result.content[0].text).toContain("Line 3");
    });

    test("reads from raw directory when mode=raw", async () => {
      const tool = createWikiReadTool(wikiRoot);
      await writeFile(join(wikiRoot, "raw/source.txt"), "Raw content");

      const result = await tool.execute("call-4", { path: "source.txt", mode: "raw" });
      expect(result.content[0].text).toContain("Raw content");
    });
  });

  describe("wiki_write", () => {
    test("creates new page", async () => {
      const tool = createWikiWriteTool(wikiRoot);
      const result = await tool.execute("call-5", {
        path: "new-page.md",
        content: "# New Page\nCreated by test.",
      });

      expect(result.content[0].text).toContain("Written");
      const exists = await Bun.file(join(wikiRoot, "wiki/new-page.md")).exists();
      expect(exists).toBe(true);
    });

    test("updates existing page", async () => {
      await writeFile(join(wikiRoot, "wiki/existing.md"), "Old content");
      const tool = createWikiWriteTool(wikiRoot);

      const result = await tool.execute("call-6", {
        path: "existing.md",
        content: "# Existing\nUpdated content",
        mode: "update",
      });

      expect(result.content[0].text).toContain("Written");
    });
  });

  describe("wiki_list", () => {
    test("lists wiki files in directory", async () => {
      await writeFile(join(wikiRoot, "wiki/page1.md"), "# Page 1");
      await mkdir(join(wikiRoot, "wiki/subdir"), { recursive: true });
      await writeFile(join(wikiRoot, "wiki/subdir/page2.md"), "# Page 2");

      const tool = createWikiListTool(wikiRoot);
      const result = await tool.execute("call-7", {});

      expect(result.content[0].text).toContain("page1.md");
    });
  });

  describe("createWikiTools", () => {
    test("creates all 6 tools", () => {
      const tools = createWikiTools({ wikiRoot });
      expect(tools.length).toBe(6);
      const names = tools.map(t => t.name);
      expect(names).toContain("wiki_read");
      expect(names).toContain("wiki_write");
      expect(names).toContain("wiki_search");
      expect(names).toContain("wiki_list");
      expect(names).toContain("wiki_ingest");
      expect(names).toContain("wiki_lint");
    });

    test("all tools have required fields", () => {
      const tools = createWikiTools({ wikiRoot });
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.label).toBeDefined();
        expect(typeof tool.execute).toBe("function");
      }
    });
  });
});
