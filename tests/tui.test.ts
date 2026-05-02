import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { InteractiveMode } from "@mariozechner/pi-coding-agent";
import { rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureWiki } from "../src/core/init.js";
import { WikiAgent } from "../src/core/agent.js";

describe("TUI", () => {
  const wikiRoot = join(tmpdir(), "llm-wiki-agent-tui-test");

  beforeAll(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
    await ensureWiki(wikiRoot);
  });

  afterAll(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  test("creates InteractiveMode without error", async () => {
    const agent = new WikiAgent();
    const runtime = await agent.createSession(wikiRoot);
    const mode = new InteractiveMode(runtime);
    expect(mode).toBeDefined();
    await runtime.dispose();
    await agent.dispose();
  });
});
