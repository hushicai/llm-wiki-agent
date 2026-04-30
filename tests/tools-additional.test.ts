import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createWikiSearchTool } from "../src/tools/wiki-search.js";
import { createWikiLintTool } from "../src/tools/wiki-lint.js";

describe("Wiki Additional Tools", () => {
  const testDir = join(tmpdir(), "llm-wiki-agent-additional-test");
  const wikiRoot = join(testDir, "wiki");

  beforeAll(async () => {
    await mkdir(join(wikiRoot, "wiki"), { recursive: true });
    await mkdir(join(wikiRoot, "raw"), { recursive: true });
    await writeFile(join(wikiRoot, "index.md"), "# Test Wiki\n\n## Pages\n\n- [[React]]\n");
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
      expect(result.content[0].text).toContain("React is a JavaScript library");
    });

    test("returns no matches when not found", async () => {
      const tool = createWikiSearchTool(wikiRoot);
      const result = await tool.execute("call-2", { query: "nonexistent-pattern-xyz" });

      expect(result.content[0].text).toBe("No matches found.");
    });
  });

  describe("wiki_lint", () => {
    test("runs without error", async () => {
      const tool = createWikiLintTool(wikiRoot);
      const result = await tool.execute("call-7", {});

      expect(result.content[0].text).toBeDefined();
    });

    test("detects orphan pages not in index.md", async () => {
      await writeFile(join(wikiRoot, "wiki/orphan-page.md"), "# Orphan");
      const tool = createWikiLintTool(wikiRoot);
      const result = await tool.execute("call-lint-orphan", {});

      expect(result.content[0].text).toContain("orphan");
      expect(result.content[0].text).toContain("orphan-page.md");
    });

    test("detects broken wikilinks", async () => {
      await writeFile(
        join(wikiRoot, "wiki/with-link.md"),
        "---\ntitle: With Link\n---\nSee [[NonExistentPage]] for details.",
      );
      const tool = createWikiLintTool(wikiRoot);
      const result = await tool.execute("call-lint-wikilink", {});

      expect(result.content[0].text).toContain("Broken wikilink");
      expect(result.content[0].text).toContain("NonExistentPage");
    });

    test("does not report valid wikilinks as broken", async () => {
      await writeFile(join(wikiRoot, "wiki/existing-target.md"), "# Existing Target");
      await writeFile(
        join(wikiRoot, "wiki/valid-link.md"),
        "---\ntitle: Valid Link\n---\nSee [[Existing Target]].",
      );
      const tool = createWikiLintTool(wikiRoot);
      const result = await tool.execute("call-lint-valid", {});

      const text = result.content[0].text;
      const brokenMatch = text.match(/Broken wikilink: "([^"]+)"/g) || [];
      const brokenTargets = brokenMatch.map((s: string) => s.match(/"([^"]+)"/)![1]);
      expect(brokenTargets).not.toContain("Existing Target");
    });

    test("fix=true adds orphan page to index.md", async () => {
      await writeFile(join(wikiRoot, "wiki/fix-orphan.md"), "---\ntitle: Fix Orphan\n---\nOrphan content.");
      const tool = createWikiLintTool(wikiRoot);
      const result = await tool.execute("call-lint-fix1", { mode: "full", fix: true });

      expect(result.content[0].text).toContain("Fix Orphan");
      expect(result.content[0].text).toContain("Added");

      const indexContent = await Bun.file(join(wikiRoot, "index.md")).text();
      expect(indexContent).toContain("[[Fix Orphan]]");
    });

    test("fix=true creates stub page for broken wikilink", async () => {
      await writeFile(
        join(wikiRoot, "wiki/broken-link-page.md"),
        "---\ntitle: Broken Link Page\n---\nSee [[NonExistentStub]] for details.",
      );
      const tool = createWikiLintTool(wikiRoot);
      const result = await tool.execute("call-lint-fix2", { mode: "full", fix: true });

      expect(result.content[0].text).toContain("NonExistentStub");
      expect(result.content[0].text).toContain("Stub created");

      const stubPath = join(wikiRoot, "wiki/nonexistentstub.md");
      const stubExists = await Bun.file(stubPath).exists();
      expect(stubExists).toBe(true);
      const stubContent = await Bun.file(stubPath).text();
      expect(stubContent).toContain("NonExistentStub");
    });
  });
});
