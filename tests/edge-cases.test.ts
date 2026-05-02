// Edge case tests for llm-wiki-agent runtime
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureWiki, loadWikiConfig, getContentDirs, buildStructureDiagram } from "../src/core/init.js";
import { getAgentDir, getSessionDir, getModelsPath, slugify } from "../src/core/config.js";

describe("Edge cases", () => {
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

  describe("getContentDirs", () => {
    test("returns empty array for non-existent directory", async () => {
      const dirs = await getContentDirs("/nonexistent/path");
      expect(dirs).toEqual([]);
    });

    test("filters out system directories", async () => {
      const dir = join(testDir, "content-test-sys");
      await mkdir(dir, { recursive: true });
      await mkdir(join(dir, ".wiki"));
      await mkdir(join(dir, "raw"));
      await mkdir(join(dir, "wiki"));
      await mkdir(join(dir, ".devops"));

      const dirs = await getContentDirs(dir);
      expect(dirs).not.toContain(".wiki");
      expect(dirs).not.toContain("raw");
      expect(dirs).not.toContain("wiki");
      expect(dirs).not.toContain(".devops");
    });

    test("returns sorted content directories", async () => {
      const dir = join(testDir, "content-test-sorted");
      await mkdir(dir, { recursive: true });
      await mkdir(join(dir, "c-proj"));
      await mkdir(join(dir, "a-proj"));
      await mkdir(join(dir, "b-proj"));

      const dirs = await getContentDirs(dir);
      expect(dirs).toEqual(["a-proj", "b-proj", "c-proj"]);
    });
  });

  describe("buildStructureDiagram", () => {
    test("returns default structure for empty dirs", () => {
      const diagram = buildStructureDiagram([]);
      expect(diagram).toContain("index.md");
      expect(diagram).toContain("log.md");
      expect(diagram).toContain("raw/");
      expect(diagram).toContain("wiki/");
    });

    test("includes content directories in diagram", () => {
      const diagram = buildStructureDiagram(["docs", "notes"]);
      expect(diagram).toContain("docs");
      expect(diagram).toContain("notes");
      expect(diagram).toContain("wiki/");
      expect(diagram).toContain("index.md");
    });
  });

});
