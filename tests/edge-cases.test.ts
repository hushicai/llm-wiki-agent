// Edge case tests for llm-wiki-agent tools and runtime
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureWiki, loadWikiConfig } from "../src/init.js";
import { createWikiSession } from "../src/runtime.js";
import { getAgentDir, getSessionDir, getModelsPath, slugify } from "../src/config.js";
import { createWikiWriteTool } from "../src/tools/wiki-write.js";
import { createWikiSearchTool } from "../src/tools/wiki-search.js";
import { createWikiLintTool } from "../src/tools/wiki-lint.js";

describe("Tool edge cases", () => {
  const testDir = join(tmpdir(), "llm-wiki-agent-edge-test");
  const wikiRoot = join(testDir, "wiki");

  beforeAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(join(wikiRoot, "wiki"), { recursive: true });
    await mkdir(join(wikiRoot, "raw"), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("wiki_write edge cases", () => {
    const tool = createWikiWriteTool(wikiRoot);

    test("writes empty content", async () => {
      const result = await tool.execute("call-ew1", {
        path: "empty-content.md",
        content: "",
      });
      expect(result.content[0].text).toContain("Written");
    });

    test("writes to subdirectory", async () => {
      await mkdir(join(wikiRoot, "deep"), { recursive: true });
      const result = await tool.execute("call-ew2", {
        path: "deep/nested-page.md",
        content: "# Deeply nested",
      });
      expect(result.content[0].text).toContain("Written");
    });

    test("mode=create fails on existing file", async () => {
      await writeFile(join(wikiRoot, "wiki/existing-create.md"), "Original");
      const result = await tool.execute("call-ew3", {
        path: "existing-create.md",
        content: "Replacement",
        mode: "create",
      });
      expect(result.content[0].text).toContain("Error");
    });

    test("mode=update overwrites existing file", async () => {
      await writeFile(join(wikiRoot, "to-update.md"), "Before");
      const result = await tool.execute("call-ew4", {
        path: "to-update.md",
        content: "After",
        mode: "update",
      });
      expect(result.content[0].text).toContain("Written");
      const content = await Bun.file(join(wikiRoot, "wiki/to-update.md")).text();
      expect(content).toContain("After");
    });

    test("writes content with special characters", async () => {
      const specialContent = "# Special\n\n- & < > \" '\n- 中文内容\n- emoji 🎉";
      const result = await tool.execute("call-ew5", {
        path: "special.md",
        content: specialContent,
      });
      expect(result.content[0].text).toContain("Written");
      const content = await Bun.file(join(wikiRoot, "wiki/special.md")).text();
      expect(content).toContain("中文内容");
      expect(content).toContain("🎉");
    });
  });

  describe("wiki_search edge cases", () => {
    const tool = createWikiSearchTool(wikiRoot);

    beforeAll(async () => {
      await writeFile(join(wikiRoot, "wiki/alpha.md"), "# Alpha\nContent with unique_word_xyz");
      await writeFile(join(wikiRoot, "wiki/beta.md"), "# Beta\nAlso has unique_word_xyz");
    });

    test("finds matching content in subdirectories", async () => {
      await mkdir(join(wikiRoot, "wiki/entities"), { recursive: true });
      await writeFile(join(wikiRoot, "wiki/entities/react.md"), "React is a UI library. subdir_search_token");
      const result = await tool.execute("call-es1", { query: "subdir_search_token" });
      expect(result.content[0].text).toContain("entities/react.md");
    });

    test("case insensitive search", async () => {
      const result = await tool.execute("call-es2", { query: "UNIQUE_WORD_XYZ" });
      expect(result.content[0].text).toContain("alpha.md");
    });

    test("returns no matches for empty wiki", async () => {
      const result = await tool.execute("call-es3", { query: "nonexistent_12345" });
      expect(result.content[0].text).toBe("No matches found.");
    });
  });

  describe("wiki_lint edge cases", () => {
    const tool = createWikiLintTool(wikiRoot);

    test("quick mode runs without error", async () => {
      const result = await tool.execute("call-el1", { mode: "quick" });
      expect(result.content[0].text).toBeDefined();
    });

    test("full mode runs without error", async () => {
      const result = await tool.execute("call-el2", { mode: "full" });
      expect(result.content[0].text).toBeDefined();
    });

    test("lint detects missing index.md", async () => {
      // Temporarily remove index.md
      const indexPath = join(wikiRoot, "index.md");
      const backup = await Bun.file(indexPath).exists() ? await Bun.file(indexPath).text() : null;
      if (backup !== null) {
        await rm(indexPath);
      }
      const result = await tool.execute("call-el3", {});
      expect(result.content[0].text).toContain("Missing");
      if (backup !== null) {
        await writeFile(indexPath, backup);
      }
    });
  });

  describe("Config edge cases", () => {
    test("slugify handles empty string", () => {
      expect(slugify("")).toBe("");
    });

    test("slugify handles special characters", () => {
      expect(slugify("hello world!@#")).toBe("hello_world___");
    });

    test("slugify preserves alphanumeric and hyphens", () => {
      expect(slugify("my-wiki_v2")).toBe("my-wiki_v2");
    });

    test("slugify lowercases uppercase", () => {
      expect(slugify("HelloWorld")).toBe("helloworld");
    });

    test("getAgentDir contains .llm-wiki-agent", () => {
      expect(getAgentDir()).toContain(".llm-wiki-agent");
    });

    test("getSessionDir includes wiki slug", () => {
      const dir = getSessionDir("my-wiki");
      expect(dir).toContain("my-wiki");
    });

    test("getModelsPath returns models.json path", () => {
      expect(getModelsPath()).toContain("models.json");
    });
  });

  describe("Init edge cases", () => {
    test("ensureWiki creates valid .wikiconfig.yaml", async () => {
      const result = await ensureWiki(wikiRoot);
      expect(result.created).toBeDefined();
    });

    test("loadWikiConfig returns null for missing config", async () => {
      const config = await loadWikiConfig("/nonexistent/path");
      expect(config).toBeNull();
    });

    test("ensureWiki on non-existent root creates all directories", async () => {
      const tempRoot = join(testDir, "fresh-wiki");
      const result = await ensureWiki(tempRoot);
      expect(result.created.length).toBeGreaterThan(0);
      await rm(tempRoot, { recursive: true, force: true });
    });
  });

  describe("Runtime edge cases", () => {
    test("dispose is idempotent", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      await runtime.dispose();
      await runtime.dispose();
    });

    test("session isolation between wikis", async () => {
      const wiki1 = join(testDir, "wiki-a");
      const wiki2 = join(testDir, "wiki-b");
      await ensureWiki(wiki1);
      await ensureWiki(wiki2);
      const r1 = await createWikiSession({ wikiRoot: wiki1 });
      const r2 = await createWikiSession({ wikiRoot: wiki2 });
      expect(r1.session).toBeDefined();
      expect(r2.session).toBeDefined();
      await r1.dispose();
      await r2.dispose();
      await rm(wiki1, { recursive: true, force: true });
      await rm(wiki2, { recursive: true, force: true });
    });

    test("diagnostics array is accessible", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      expect(runtime.diagnostics).toBeDefined();
      await runtime.dispose();
    });
  });
});
