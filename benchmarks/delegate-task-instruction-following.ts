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
import { writeFileSync, readdirSync, existsSync, rmSync } from "fs";
import { join } from "path";

const BENCH_ROOT = "/tmp/benchmark-wiki";

interface Check {
  description: string;
  pass: (output: string, toolCalls: string[]) => boolean;
}

interface BenchmarkCase {
  name: string;
  agent: "ingest" | "query" | "lint";
  userMessage: string;
  wikiSetup?: () => void | Promise<void>;
  checks: Check[];
}

const RAW_DIR = join(BENCH_ROOT, "raw");
const WIKI_DIR = join(BENCH_ROOT, "wiki");

function listFiles(dir: string, ext = ".md"): string[] {
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith(ext))
      .sort();
  } catch {
    return [];
  }
}

function countFiles(dir: string): number {
  try {
    return readdirSync(dir).filter(f => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

const CASES: BenchmarkCase[] = [
  {
    name: "ingest: creates raw + wiki file",
    agent: "ingest",
    userMessage: "录入 https://example.com/article",
    async checks() {
      const beforeRaw = countFiles(RAW_DIR);
      const beforeWiki = countFiles(WIKI_DIR);

      const output = ""; // filled by runner
      const toolCalls: string[] = []; // filled by runner

      // After running, there should be new files
      const afterRaw = countFiles(RAW_DIR);
      const afterWiki = countFiles(WIKI_DIR);

      return [
        {
          description: "creates a raw/ file",
          pass: () => afterRaw > beforeRaw,
        },
        {
          description: "creates a wiki/ file",
          pass: () => afterWiki > beforeWiki,
        },
      ];
    },
  },
  {
    name: "query: reads index first",
    agent: "query",
    userMessage: "关于 Transformers 我知道什么？",
    checks: [
      {
        description: "subagent output is not empty",
        pass: (output) => output.trim().length > 10,
      },
    ],
  },
  {
    name: "lint: reads index",
    agent: "lint",
    userMessage: "检查一下 wiki",
    checks: [
      {
        description: "output indicates index was checked",
        pass: (output) => output.length > 0,
      },
    ],
  },
];

async function runCase(
  c: BenchmarkCase,
  wikiRoot: string,
): Promise<{
  name: string;
  passed: boolean;
  details: string[];
  toolCalls: string[];
}> {
  const tool = createWikiDelegateTaskTool(wikiRoot);
  const ac = new AbortController();
  const ctx = {
    context: {
      messages: [{ role: "user", content: c.userMessage }],
    },
  } as any;

  const capturedTools: string[] = [];
  const capturedArgs: string[] = [];

  try {
    const result = await tool.execute(
      `bench-${Date.now()}`,
      { agent: c.agent },
      ac.signal,
      (update: any) => {
        if (update.details?.toolName) {
          capturedTools.push(update.details.toolName);
          capturedArgs.push(update.details.args || "");
        }
      },
      ctx,
    );

    const output = (result.content as any[])?.[0]?.text ?? "";

    // Get dynamic checks (some cases generate checks based on state)
    const checks = await (typeof c.checks === "function"
      ? (c.checks as any)(output, capturedTools)
      : c.checks);

    const details: string[] = [];
    let allPassed = true;

    for (const check of checks) {
      const ok = check.pass(output, capturedTools);
      if (!ok) allPassed = false;
      details.push(`${ok ? "✓" : "✗"} ${check.description}`);
    }

    return {
      name: c.name,
      passed: allPassed,
      details,
      toolCalls: capturedTools,
    };
  } catch (e: any) {
    return {
      name: c.name,
      passed: false,
      details: [`ERROR: ${e.message}`],
      toolCalls: capturedTools,
    };
  }
}

async function main() {
  // Clean benchmark wiki
  try {
    rmSync(BENCH_ROOT, { recursive: true, force: true });
  } catch { /* ignore */ }
  await ensureWiki(BENCH_ROOT);

  // Add a sample page for query/lint tests
  writeFileSync(
    join(WIKI_DIR, "transformers.md"),
    `---\ntitle: Transformers\ntype: concept\ncreated: 2025-01-01\nupdated: 2025-01-01\nsources: []\n---\n\n# Transformers\n\nAttention is all you need.\n`
  );
  writeFileSync(join(WIKI_DIR, "index.md"), `# Wiki\n\n## Pages\n\n- [[Transformers]]\n`);

  console.log("=".repeat(60));
  console.log("Delegate-task Instruction Following Benchmark");
  console.log("=".repeat(60));
  console.log();

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`Running: ${c.name}... `);
    const result = await runCase(c, BENCH_ROOT);
    results.push(result);
    console.log(result.passed ? "✓" : "✗");
    for (const d of result.details) {
      console.log(`  ${d}`);
    }
  }

  console.log();
  console.log("-".repeat(60));

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const score = Math.round((passed / total) * 100);

  console.log(`Score: ${passed}/${total} (${score}%)`);

  // Write JSON report
  const report = {
    timestamp: new Date().toISOString(),
    score,
    passed,
    total,
    cases: results.map(r => ({
      name: r.name,
      passed: r.passed,
      details: r.details,
      toolCalls: r.toolCalls,
    })),
  };

  const reportPath = join(process.cwd(), "benchmarks", "delegate-task-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log();
  console.log(`Report: ${reportPath}`);
}

main().catch(console.error);
