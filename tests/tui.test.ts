import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { InteractiveMode } from "@mariozechner/pi-coding-agent";
import { rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureWiki } from "../src/init.js";
import { createWikiSession } from "../src/runtime.js";

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
    const runtime = await createWikiSession({ wikiRoot });
    const mode = new InteractiveMode(runtime);
    expect(mode).toBeDefined();
    expect(mode.session).toBeDefined();
    expect(mode.agent).toBeDefined();
    await runtime.dispose();
  });

  test("session has 5 custom wiki tools only (no native tools)", async () => {
    const runtime = await createWikiSession({ wikiRoot });
    const session = runtime.session;
    const tools = session.state.tools;
    const names = tools.map(t => t.name);
    expect(names).toContain("wiki_search");
    expect(names).toContain("wiki_write");
    expect(names).toContain("wiki_lint");
    expect(names).toContain("wiki_read");
    expect(names).toContain("wiki_list");
    // No native tools should be available
    expect(tools.length).toBe(5);
    await runtime.dispose();
  });

  test("noSkills blocks external skills from ~/.agents/skills/", async () => {
    const runtime = await createWikiSession({ wikiRoot });
    const rl = (runtime.session as any)["_resourceLoader"];
    expect(rl).toBeDefined();
    expect(rl["noSkills"]).toBe(true);
    expect(rl["skills"]?.length || 0).toBe(0);
    await runtime.dispose();
  });

  test("additionalSkillPaths includes ~/.llm-wiki-agent/skills/ when dir exists", async () => {
    const { mkdir } = await import("fs/promises");
    const { getAgentDir } = await import("../src/config.js");
    await mkdir(join(getAgentDir(), "skills"), { recursive: true });

    const runtime = await createWikiSession({ wikiRoot });
    const rl = (runtime.session as any)["_resourceLoader"];
    const paths: string[] = rl["additionalSkillPaths"] || [];
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p: string) => p.includes(".llm-wiki-agent") && p.includes("skills"))).toBe(true);
    await runtime.dispose();
  });
});
