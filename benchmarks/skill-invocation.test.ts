// benchmarks/skill-invocation.test.ts
// Benchmark: test whether the LLM correctly invokes wiki skills
// (wiki-ingest, wiki-query, wiki-lint) when given appropriate prompts.
//
// Run: bun test benchmarks/skill-invocation.test.ts --timeout 30000

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm, appendFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { WikiAgent } from "../src/core/agent.js";
import { ensureWiki } from "../src/core/init.js";

const REPORT_PATH = join(import.meta.dir, "benchmark-report.md");

interface TestCase {
  name: string;
  expectSkill: string;
  setup: (wikiRoot: string) => Promise<void>;
  prompt: string;
  /** Returns true if the agent behavior matches the expected skill */
  check: (events: TraceEvent[], messages: any[]) => boolean;
}

interface TraceEvent {
  type: string;
  toolName?: string;
  args?: any;
}

const CASES: TestCase[] = [
  {
    name: "ingest: 处理 raw 文件",
    expectSkill: "wiki-ingest",
    setup: async (wikiRoot) => {
      await writeFile(
        join(wikiRoot, "raw", "react-intro.md"),
        [
          "# React",
          "",
          "React is a JavaScript library for building user interfaces.",
          "Created by Facebook (now Meta) in 2013.",
          "Key features: component-based, virtual DOM, JSX.",
        ].join("\n"),
      );
    },
    prompt: "帮我处理 raw/react-intro.md 的内容，录入到 wiki",
    check: (events) => {
      // wiki-ingest: reads raw file → writes wiki page
      const reads = events.filter((e) => e.toolName === "read");
      const writes = events.filter((e) => e.toolName === "write");
      return reads.length >= 1 && writes.length >= 1;
    },
  },
  {
    name: "query: 搜索已有知识",
    expectSkill: "wiki-query",
    setup: async (wikiRoot) => {
      await writeFile(
        join(wikiRoot, "wiki", "dependency-injection.md"),
        [
          "---",
          "title: Dependency Injection",
          "type: concept",
          "created: 2026-04-30",
          "---",
          "",
          "# Dependency Injection",
          "",
          "Dependency Injection (DI) is a design pattern where objects",
          "receive dependencies from an external source.",
          "Common in Spring, Angular, NestJS.",
        ].join("\n"),
      );
    },
    prompt: "查一下什么是依赖注入？",
    check: (events, messages) => {
      // wiki-query: searches wiki → reads → answers with source
      const searches = events.filter((e) =>
        ["grep", "find", "read"].includes(e.toolName || ""),
      );
      const lastAssistant = messages
        .filter((m) => m.role === "assistant")
        .pop();
      const text = lastAssistant?.content
        ?.map((c: any) => (c.type === "text" ? c.text : ""))
        .join("");
      return (
        searches.length >= 1 &&
        text?.includes("依赖注入") &&
        !text?.includes("wiki 中未找到")
      );
    },
  },
  {
    name: "lint: 健康检查",
    expectSkill: "wiki-lint",
    setup: async (wikiRoot) => {
      // Create an orphan page (not in index.md)
      await writeFile(
        join(wikiRoot, "wiki", "orphan-page.md"),
        [
          "---",
          "title: Orphan Page",
          "type: note",
          "created: 2026-04-30",
          "---",
          "",
          "# Orphan Page",
          "This page is not in index.md.",
        ].join("\n"),
      );
    },
    prompt: "检查一下 wiki 的健康状态",
    check: (events, messages) => {
      // wiki-lint: reads index.md, checks wiki structure
      const readsIndex = events.filter(
        (e) =>
          e.toolName === "read" &&
          typeof e.args === "object" &&
          e.args !== null &&
          String(e.args?.path || "").includes("index"),
      );
      const lastAssistant = messages
        .filter((m) => m.role === "assistant")
        .pop();
      const text = lastAssistant?.content
        ?.map((c: any) => (c.type === "text" ? c.text : ""))
        .join("");
      return readsIndex.length >= 1 && text?.length > 0;
    },
  },
];

const testDir = join(tmpdir(), "llm-wiki-agent-benchmark");
let agent: WikiAgent;

describe("Skill invocation benchmark", () => {
  beforeAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    agent = new WikiAgent();

    // Initialize report
    const header = [
      "# Skill Invocation Benchmark Report",
      "",
      `Date: ${new Date().toISOString().split("T")[0]}`,
      `Model: ${agent.getModels().map((m) => `${m.provider}/${m.id}`).join(", ") || "default"}`,
      "",
      "| # | Skill | Test Case | Tools Called | Result | Duration |",
      "|---|-------|-----------|-------------|--------|----------|",
    ].join("\n");
    await writeFile(REPORT_PATH, header + "\n");
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    await agent.dispose();
  });

  let passed = 0;
  let failed = 0;

  for (const c of CASES) {
    test(
      c.name,
      async () => {
        const wikiRoot = join(
          testDir,
          c.name.replace(/[^a-z0-9]/gi, "-"),
        );

        // Setup fresh wiki
        await rm(wikiRoot, { recursive: true, force: true });
        await ensureWiki(wikiRoot);
        await c.setup(wikiRoot);

        // Create session and trace events
        const runtime = await agent.createSession(wikiRoot);
        const events: TraceEvent[] = [];

        const unsub = runtime.session.subscribe((event: any) => {
          if (event.type === "tool_execution_start") {
            events.push({
              type: "tool_call",
              toolName: event.toolName,
              args: event.args,
            });
          }
        });

        const startTime = Date.now();
        await runtime.session.prompt(c.prompt);
        const duration = Date.now() - startTime;
        unsub();

        // Collect messages
        const messages = runtime.session.state.messages;

        // Evaluate
        const result = c.check(events, messages);

        const toolNames =
          events.map((e) => e.toolName).join(", ") || "(none)";

        console.log(`\n  [${c.expectSkill}] ${c.name}`);
        console.log(`  Prompt: "${c.prompt}"`);
        console.log(`  Tools: ${toolNames}`);

        if (result) {
          passed++;
          console.log(`  ✅ PASS`);
        } else {
          failed++;
          console.log(`  ❌ FAIL`);
          const lastMsg = messages
            .filter((m) => m.role === "assistant")
            .pop();
          const text = lastMsg?.content
            ?.map((c: any) => (c.type === "text" ? c.text : ""))
            .join("");
          if (text) console.log(`  Response: ${text.slice(0, 300)}`);
        }

        // Append report row
        const row = `| ${passed + failed} | ${c.expectSkill} | ${c.name} | ${toolNames} | ${result ? "✅ PASS" : "❌ FAIL"} | ${(duration / 1000).toFixed(1)}s |\n`;
        await appendFile(REPORT_PATH, row);

        await runtime.dispose();
        expect(result).toBe(true);
      },
      { timeout: 120000 },
    );
  }

  afterAll(async () => {
    const total = passed + failed;
    const summary = [
      "",
      `**Results: ${passed}/${total} passed — Accuracy: ${total > 0 ? ((passed / total) * 100).toFixed(0) : 0}%**`,
      "",
    ].join("\n");
    await appendFile(REPORT_PATH, summary);
    console.log(`\nReport saved to: ${REPORT_PATH}`);

    await rm(testDir, { recursive: true, force: true });
    await agent.dispose();
  });
});
