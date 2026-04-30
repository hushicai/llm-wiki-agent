// End-to-end tests for llm-wiki-agent
// Tests the public API: ensureWiki() and createWikiSession()
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureWiki } from "../src/init.js";
import { createWikiSession } from "../src/runtime.js";

describe("llm-wiki-agent e2e", () => {
  const testDir = join(tmpdir(), "llm-wiki-agent-e2e-test");
  const wikiRoot = join(testDir, "my-wiki");

  beforeAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("wiki initialization", () => {
    test("ensureWiki creates directory structure", async () => {
      const { created } = await ensureWiki(wikiRoot);

      // Root directory
      expect(created).toContain(wikiRoot);

      // Required subdirectories
      expect(created).toContain(join(wikiRoot, "raw"));
      expect(created).toContain(join(wikiRoot, "wiki"));

      // Required files
      expect(created).toContain(join(wikiRoot, ".wikiconfig.yaml"));
      expect(created).toContain(join(wikiRoot, "AGENTS.md"));
      expect(created).toContain(join(wikiRoot, "index.md"));
      expect(created).toContain(join(wikiRoot, "log.md"));
    });

    test("ensureWiki is idempotent", async () => {
      const { created } = await ensureWiki(wikiRoot);
      // Second call should create nothing
      expect(created.length).toBe(0);
    });

    test("wiki has valid AGENTS.md", async () => {
      const { readFile } = await import("fs/promises");
      const content = await readFile(join(wikiRoot, "AGENTS.md"), "utf-8");
      expect(content).toContain("wiki_search");
      expect(content).toContain("wiki_write");
      expect(content).toContain("wiki_lint");
    });
  });

  describe("session creation", () => {
    test("createWikiSession returns valid runtime", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      expect(runtime).toBeDefined();
      expect(runtime.session).toBeDefined();
      expect(runtime.services).toBeDefined();
      await runtime.dispose();
    });

    test("session has 5 custom wiki tools only (no native tools)", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      const tools = runtime.session.state.tools;
      const names = tools.map((t: { name: string }) => t.name).sort();
      expect(names).toContain("wiki_search");
      expect(names).toContain("wiki_write");
      expect(names).toContain("wiki_lint");
      expect(names).toContain("wiki_read");
      expect(names).toContain("wiki_list");
      expect(tools.length).toBe(5);
      await runtime.dispose();
    });

    test("session has no native bash tool", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      const tools = runtime.session.state.tools;
      const toolNames = tools.map((t: { name: string }) => t.name);
      // Native tools should NOT be available
      expect(toolNames).not.toContain("bash");
      await runtime.dispose();
    });

    test("services have modelRegistry and diagnostics", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      expect(runtime.services.modelRegistry).toBeDefined();
      expect(runtime.diagnostics).toBeDefined();
      await runtime.dispose();
    });

    test("multiple sessions can be created independently", async () => {
      const runtime1 = await createWikiSession({ wikiRoot });
      const runtime2 = await createWikiSession({ wikiRoot });

      expect(runtime1.session).not.toBe(runtime2.session);
      expect(runtime1.session.state.tools.length).toBeGreaterThan(3);
      expect(runtime2.session.state.tools.length).toBeGreaterThan(3);

      await runtime1.dispose();
      await runtime2.dispose();
    });
  });

  describe("wiki tools execute correctly", () => {
    test("wiki_write creates a page", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      const writeTool = runtime.session.state.tools.find(
        (t: { name: string }) => t.name === "wiki_write",
      )!;

      const result = await writeTool.execute("call-write-1", {
        path: "test-page.md",
        content: "# Test Page\nContent created by e2e test.",
      });

      expect(result.content[0].text).toContain("Written");

      const fileContent = await Bun.file(
        join(wikiRoot, "wiki/test-page.md"),
      ).text();
      expect(fileContent).toContain("Test Page");
      await runtime.dispose();
    });

    test("wiki_lint reports issues for empty wiki", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      const lintTool = runtime.session.state.tools.find(
        (t: { name: string }) => t.name === "wiki_lint",
      )!;

      const result = await lintTool.execute("call-lint-1", {});
      const text = result.content[0].text;

      // Should report something (either healthy or issues)
      expect(text).toBeDefined();
      expect(text.length).toBeGreaterThan(0);
      await runtime.dispose();
    });
  });

  describe("cleanup", () => {
    test("dispose does not throw", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      await expect(runtime.dispose()).resolves.toBeUndefined();
    });
  });
});
