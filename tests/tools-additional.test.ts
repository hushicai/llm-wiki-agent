import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createWikiSearchTool } from "../src/tools/wiki-search.js";
import { createWikiIngestTool } from "../src/tools/wiki-ingest.js";
import { createWikiLintTool } from "../src/tools/wiki-lint.js";

describe("Wiki Additional Tools", () => {
  const testDir = join(tmpdir(), "llm-wiki-agent-additional-test");
  const wikiRoot = join(testDir, "wiki");

  beforeAll(async () => {
    await mkdir(join(wikiRoot, "wiki"), { recursive: true });
    await mkdir(join(wikiRoot, "raw"), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("wiki_search", () => {
    test("finds matching content", async () => {
      await writeFile(join(wikiRoot, "wiki/react.md"), "# React\nReact is a JavaScript library.");

      const tool = createWikiSearchTool(wikiRoot);
      const result = await tool.execute("call-1", { query: "JavaScript" });

      expect(result.content[0].text).toContain("react.md");
    });

    test("returns no matches when not found", async () => {
      const tool = createWikiSearchTool(wikiRoot);
      const result = await tool.execute("call-2", { query: "nonexistent-pattern-xyz" });

      expect(result.content[0].text).toBe("No matches found.");
    });

    test("respects limit parameter", async () => {
      await writeFile(join(wikiRoot, "wiki/a.md"), "# A\ncontent xyz");
      await writeFile(join(wikiRoot, "wiki/b.md"), "# B\ncontent xyz");

      const tool = createWikiSearchTool(wikiRoot);
      const result = await tool.execute("call-3", { query: "xyz", limit: 1 });

      const lines = result.content[0].text.split("\n").filter(l => l);
      expect(lines.length).toBeLessThanOrEqual(1);
    });

    test("searches in raw directory when scope=raw", async () => {
      await writeFile(join(wikiRoot, "raw/source.md"), "Some raw content with keyword");

      const tool = createWikiSearchTool(wikiRoot);
      const result = await tool.execute("call-4", { query: "keyword", scope: "raw" });

      expect(result.content[0].text).toContain("source.md");
    });
  });

  describe("wiki_ingest", () => {
    test("returns content from raw source", async () => {
      await writeFile(join(wikiRoot, "raw/test.txt"), "Test content for ingest");
      const tool = createWikiIngestTool(wikiRoot);
      const result = await tool.execute("call-5", { source_path: "test.txt" });

      expect(result.content[0].text).toContain("Test content");
    });

    test("returns error for missing source", async () => {
      const tool = createWikiIngestTool(wikiRoot);
      const result = await tool.execute("call-6", { source_path: "nonexistent.txt" });

      expect(result.content[0].text).toContain("Error");
    });
  });

  describe("wiki_lint", () => {
    test("runs without error", async () => {
      const tool = createWikiLintTool(wikiRoot);
      const result = await tool.execute("call-7", {});

      expect(result.content[0].text).toBeDefined();
    });
  });
});
