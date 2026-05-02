// Tests the public API: ensureWiki() and WikiAgent.createSession()
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureWiki } from "../src/core/init.js";
import { WikiAgent } from "../src/core/agent.js";

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
    test("WikiAgent.createSession returns valid runtime", async () => {
      const agent = new WikiAgent();
      const runtime = await agent.createSession(wikiRoot);
      expect(runtime).toBeDefined();
      expect(runtime.session).toBeDefined();
      expect(runtime.services).toBeDefined();
      await runtime.dispose();
      await agent.dispose();
    });

    test("services have modelRegistry and diagnostics", async () => {
      const agent = new WikiAgent();
      const runtime = await agent.createSession(wikiRoot);
      expect(runtime.services.modelRegistry).toBeDefined();
      expect(runtime.diagnostics).toBeDefined();
      await runtime.dispose();
      await agent.dispose();
    });

    test("multiple sessions can be created independently", async () => {
      const agent = new WikiAgent();
      const runtime1 = await agent.createSession(wikiRoot);
      const runtime2 = await agent.createSession(wikiRoot);

      expect(runtime1.session).not.toBe(runtime2.session);
      expect(runtime1.session.state.tools.length).toBe(1);
      expect(runtime2.session.state.tools.length).toBe(1);

      await runtime1.dispose();
      await runtime2.dispose();
      await agent.dispose();
    });
  });

  describe("cleanup", () => {
    test("dispose does not throw", async () => {
      const agent = new WikiAgent();
      const runtime = await agent.createSession(wikiRoot);
      await expect(runtime.dispose()).resolves.toBeUndefined();
      await agent.dispose();
    });
  });

  describe("WikiAgent.getModels", () => {
    test("returns empty array before any session", () => {
      const agent = new WikiAgent();
      expect(agent.getModels()).toEqual([]);
      agent.dispose();
    });

    test("returns cached models after createSession", async () => {
      const agent = new WikiAgent();
      await agent.createSession(wikiRoot);
      const models = agent.getModels();
      expect(Array.isArray(models)).toBe(true);
      if (models.length > 0) {
        expect(models[0].id).toBeDefined();
        expect(models[0].provider).toBeDefined();
      }
      await agent.dispose();
    });

    test("returns empty array after dispose", async () => {
      const agent = new WikiAgent();
      await agent.createSession(wikiRoot);
      await agent.dispose();
      expect(agent.getModels()).toEqual([]);
    });
  });

  describe("createSession with role", () => {
    test("creates session with valid role (ingest)", async () => {
      const agent = new WikiAgent();
      const runtime = await agent.createSession(wikiRoot, { role: "ingest" });
      expect(runtime).toBeDefined();
      expect(runtime.session).toBeDefined();
      await runtime.dispose();
      await agent.dispose();
    });

    test("creates session with valid role (query)", async () => {
      const agent = new WikiAgent();
      const runtime = await agent.createSession(wikiRoot, { role: "query" });
      expect(runtime).toBeDefined();
      await runtime.dispose();
      await agent.dispose();
    });

    test("creates session with role and allowedTools", async () => {
      const agent = new WikiAgent();
      const runtime = await agent.createSession(wikiRoot, {
        role: "query",
        allowedTools: ["read", "search"],
      });
      expect(runtime).toBeDefined();
      expect(runtime.session).toBeDefined();
      await runtime.dispose();
      await agent.dispose();
    });

    test("creates session without role does not throw", async () => {
      const agent = new WikiAgent();
      const runtime = await agent.createSession(wikiRoot);
      expect(runtime).toBeDefined();
      await runtime.dispose();
      await agent.dispose();
    });

    test("creates session with appendSystemPrompt", async () => {
      const agent = new WikiAgent();
      const runtime = await agent.createSession(wikiRoot, {
        appendSystemPrompt: ["Extra context for the agent"],
      });
      expect(runtime).toBeDefined();
      await runtime.dispose();
      await agent.dispose();
    });
  });
});
