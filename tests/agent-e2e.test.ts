// End-to-end tests for llm-wiki-agent
// Tests the public API: ensureWiki() and createWikiSession()
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureWiki } from "../src/core/init.js";
import { createWikiSession } from "../src/core/runtime.js";

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
      expect(created).toContain(join(wikiRoot, "index.md"));
      expect(created).toContain(join(wikiRoot, "log.md"));
    });

    test("ensureWiki is idempotent", async () => {
      const { created } = await ensureWiki(wikiRoot);
      // Second call should create nothing
      expect(created.length).toBe(0);
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
      // Main agent has: wiki_delegate_task only
      expect(runtime1.session.state.tools.length).toBeGreaterThan(0);
      expect(runtime2.session.state.tools.length).toBeGreaterThan(0);

      await runtime1.dispose();
      await runtime2.dispose();
    });
  });

  describe("cleanup", () => {
    test("dispose does not throw", async () => {
      const runtime = await createWikiSession({ wikiRoot });
      await expect(runtime.dispose()).resolves.toBeUndefined();
    });
  });
});
