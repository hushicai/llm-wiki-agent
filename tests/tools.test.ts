import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createWikiWriteTool } from "../src/tools/wiki-write.js";
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

    test("auto-adds created timestamp to new page frontmatter", async () => {
      const tool = createWikiWriteTool(wikiRoot);
      await tool.execute("call-fm1", {
        path: "fm-new.md",
        content: "---\ntitle: Frontmatter Test\n---\nBody content.",
      });

      const saved = await Bun.file(join(wikiRoot, "wiki/fm-new.md")).text();
      expect(saved).toContain("title: Frontmatter Test");
      expect(saved).toMatch(/created: \d{4}-\d{2}-\d{2}/);
    });

    test("auto-updates updated timestamp on existing page", async () => {
      await writeFile(
        join(wikiRoot, "wiki/fm-update.md"),
        "---\ntitle: Update Test\ncreated: 2026-01-01\n---\nOld body.",
      );
      const tool = createWikiWriteTool(wikiRoot);
      await tool.execute("call-fm2", {
        path: "fm-update.md",
        content: "---\ntitle: Update Test\n---\nNew body.",
        mode: "update",
      });

      const saved = await Bun.file(join(wikiRoot, "wiki/fm-update.md")).text();
      expect(saved).toContain("title: Update Test");
      expect(saved).toMatch(/updated: \d{4}-\d{2}-\d{2}/);
      expect(saved).toContain("created: 2026-01-01");
    });

    test("preserves user-provided frontmatter fields", async () => {
      const tool = createWikiWriteTool(wikiRoot);
      await tool.execute("call-fm3", {
        path: "fm-preserve.md",
        content: "---\ntitle: Preserved\ntype: concept\ntags: [a, b]\n---\nBody.",
      });

      const saved = await Bun.file(join(wikiRoot, "wiki/fm-preserve.md")).text();
      expect(saved).toContain("type: concept");
      expect(saved).toContain("- a");
      expect(saved).toContain("- b");
    });
  });

  describe("createWikiTools", () => {
    test("creates 5 custom tools", () => {
      const tools = createWikiTools({ wikiRoot });
      expect(tools.length).toBe(5);
      const names = tools.map(t => t.name);
      expect(names).toContain("wiki_search");
      expect(names).toContain("wiki_write");
      expect(names).toContain("wiki_lint");
      expect(names).toContain("wiki_read");
      expect(names).toContain("wiki_list");
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
