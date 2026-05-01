/**
 * benchmarks/delegate-task-instruction-following.ts
 *
 * Evaluates the delegate-task tool's instruction following.
 * Run: bun run benchmarks/delegate-task-instruction-following.ts
 *
 * Not part of test gating — purely informational.
 */
import { createWikiDelegateTaskTool } from "../src/tools/delegate-task.js";
import { ensureWiki } from "../src/core/init.js";
import { writeFileSync } from "fs";
import { join } from "path";

const WIKI_ROOT = "/tmp/benchmark-wiki";

interface BenchmarkCase {
  name: string;
  agent: "ingest" | "query" | "lint";
  userMessage: string;
  checks: Array<{
    description: string;
    // What the subagent should have done (checked via tool calls or output)
    expectedToolCall?: string;
    expectToolCall?: boolean;
  }>;
}

const CASES: BenchmarkCase[] = [
  {
    name: "routing: ingest with URL",
    agent: "query",
    userMessage: "录入这个页面 https://example.com/article",
    checks: [
      {
        description: "should NOT call wiki_delegate_task with ingest agent when user says '录入'",
        // This tests whether the main agent correctly routes "录入" to ingest, not query
        // The subagent output should reflect ingest behavior
        expectToolCall: false,
      },
    ],
  },
  {
    name: "routing: query search",
    agent: "query",
    userMessage: "关于 Transformers 我知道什么？",
    checks: [],
  },
  {
    name: "routing: lint check",
    agent: "lint",
    userMessage: "检查一下 wiki",
    checks: [],
  },
  {
    name: "ingest: creates raw file",
    agent: "ingest",
    userMessage: "录入 https://example.com/article",
    checks: [
      {
        description: "subagent should create a raw/ file",
        expectedToolCall: "write",
      },
    ],
  },
  {
    name: "ingest: creates wiki page",
    agent: "ingest",
    userMessage: "录入 https://example.com/article",
    checks: [
      {
        description: "subagent should create a wiki/ file",
        expectedToolCall: "write",
      },
    ],
  },
  {
    name: "query: reads index first",
    agent: "query",
    userMessage: "关于 Transformers 我知道什么？",
    checks: [
      {
        description: "subagent should read wiki/index.md first",
        expectedToolCall: "read",
      },
    ],
  },
  {
    name: "lint: auto-fix index",
    agent: "lint",
    userMessage: "检查 wiki 并修复问题",
    checks: [
      {
        description: "subagent should check index consistency",
        expectedToolCall: "read",
      },
    ],
  },
];

async function runCase(c: BenchmarkCase): Promise<{
  name: string;
  passed: boolean;
  details: string;
  toolCalls: string[];
}> {
  const tool = createWikiDelegateTaskTool(WIKI_ROOT);
  const ac = new AbortController();
  const ctx = {
    context: {
      messages: [{ role: "user", content: c.userMessage }],
    },
  } as any;

  const capturedTools: string[] = [];

  try {
    const result = await tool.execute(
      `bench-${Date.now()}`,
      { agent: c.agent },
      ac.signal,
      (update: any) => {
        // Capture tool calls from onUpdate
        if (update.details?.toolName) {
          capturedTools.push(update.details.toolName);
        }
      },
      ctx,
    );

    const output = (result.content as any[])?.[0]?.text ?? "";

    // Check if expected tools were called
    let allPassed = true;
    const details: string[] = [];

    for (const check of c.checks) {
      if (check.expectToolCall === false && capturedTools.length > 0) {
        allPassed = false;
        details.push(`FAIL: ${check.description} — captured tools: ${capturedTools.join(", ")}`);
      } else if (check.expectedToolCall) {
        const found = capturedTools.some(t => t.includes(check.expectedToolCall));
        if (!found) {
          allPassed = false;
          details.push(`FAIL: ${check.description} — expected tool '${check.expectedToolCall}', captured: ${capturedTools.join(", ") || "(none)"}`);
        } else {
          details.push(`PASS: ${check.description}`);
        }
      }
    }

    if (c.checks.length === 0) {
      details.push(`INFO: No automated checks — output length: ${output.length} chars`);
    }

    return {
      name: c.name,
      passed: allPassed,
      details: details.join("; "),
      toolCalls: capturedTools,
    };
  } catch (e: any) {
    return {
      name: c.name,
      passed: false,
      details: `ERROR: ${e.message}`,
      toolCalls: capturedTools,
    };
  }
}

async function main() {
  // Ensure benchmark wiki exists
  await ensureWiki(WIKI_ROOT);

  console.log("=".repeat(60));
  console.log("Delegate-task Instruction Following Benchmark");
  console.log("=".repeat(60));
  console.log();

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`Running: ${c.name}... `);
    const result = await runCase(c);
    results.push(result);
    console.log(result.passed ? "✓" : "✗");
    if (!result.passed) {
      console.log(`  ${result.details}`);
    }
  }

  console.log();
  console.log("-".repeat(60));

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const score = Math.round((passed / total) * 100);

  console.log(`Score: ${passed}/${total} (${score}%)`);

  if (score < 100) {
    console.log();
    console.log("Failed cases:");
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  - ${r.name}: ${r.details}`);
    }
  }

  // Write JSON report
  const report = {
    timestamp: new Date().toISOString(),
    score,
    passed,
    total,
    cases: results,
  };

  const reportPath = join(process.cwd(), "benchmarks", "delegate-task-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log();
  console.log(`Report: ${reportPath}`);
}

main().catch(console.error);
