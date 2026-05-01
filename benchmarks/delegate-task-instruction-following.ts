/**
 * benchmarks/delegate-task-instruction-following.ts
 *
 * Tests whether the main agent correctly calls wiki_delegate_task tool
 * with the appropriate agent type (ingest/query/lint) based on the user's request.
 *
 * Main agent runs with real LLM (deepseek-v4-flash for speed).
 * wiki_delegate_task runs in mock mode (no real subagent, just captures tool calls).
 *
 * Run: bun run benchmarks/delegate-task-instruction-following.ts
 */
import { createWikiDelegateTaskTool } from "../src/tools/delegate-task.js";
import { ensureWiki } from "../src/core/init.js";
import { writeFileSync, rmSync } from "fs";
import { join } from "path";
import { WikiAgent } from "../src/core/agent.js";

const BENCH_ROOT = "/tmp/benchmark-wiki";

interface BenchmarkCase {
  name: string;
  userMessage: string;
  /** Which agent type the main agent SHOULD call */
  expectedAgent: "ingest" | "query" | "lint";
  /** Optional wiki state before the prompt */
  wikiSetup?: () => void;
}

const WIKI_DIR = join(BENCH_ROOT, "wiki");
const RAW_DIR = join(BENCH_ROOT, "raw");

const CASES: BenchmarkCase[] = [
  {
    name: "main → ingest when adding content",
    userMessage: "录入 https://example.com/article 关于 Transformer 的内容",
    expectedAgent: "ingest",
  },
  {
    name: "main → query when searching",
    userMessage: "关于 Transformer 我知道什么？",
    expectedAgent: "query",
    wikiSetup: () => {
      writeFileSync(
        join(WIKI_DIR, "transformers.md"),
        "---\ntitle: Transformers\ntype: concept\n---\n\n# Transformers\n\nAttention is all you need.\n"
      );
    },
  },
  {
    name: "main → lint when reviewing",
    userMessage: "检查一下 wiki 质量",
    expectedAgent: "lint",
  },
];

async function runCase(
  c: BenchmarkCase,
  wikiRoot: string
): Promise<{
  name: string;
  expectedAgent: string;
  delegateToolCalls: { agent: string; wikiRoot: string }[];
  passed: boolean;
  details: string[];
}> {
  // Setup wiki state
  if (c.wikiSetup) c.wikiSetup();

  // Create delegate-task tool in MOCK mode — captures calls without spinning up subagent
  const delegateTool = createWikiDelegateTaskTool(wikiRoot, { mockMode: true });

  // All wiki tools for the main agent
  const wikiTools = createWikiTools(wikiRoot);

  // Main agent session with delegate-task + wiki tools
  const agent = new WikiAgent();
  const runtime = await agent.createSession(wikiRoot, {
    tools: [...wikiTools, delegateTool],
  });
  const session = runtime.session;

  const delegateToolCalls: { agent: string; wikiRoot: string }[] = [];

  // Subscribe to capture delegate-task calls
  session.subscribe((event: any) => {
    if (event.type === "tool_execution_end") {
      if (event.toolName === "wiki_delegate_task") {
        // The tool result may contain details about what subagent was called
        // But since we're in mock mode, we won't see the subagent's internal calls
        // from here. We check the result's details instead.
      }
    }
  });

  // Send user message
  await session.prompt(c.userMessage);

  // Wait for agent to finish
  await new Promise((r) => setTimeout(r, 500));

  // Check session messages for delegate-task tool calls
  const messages = session.state.messages;
  for (const msg of messages) {
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "toolResult" && part.name === "wiki_delegate_task") {
          try {
            const args = typeof part.content === "string"
              ? JSON.parse(part.content)
              : part.content;
            // Tool result content is the text output; actual args come from the tool call
            // We need to look at the preceding assistant message
          } catch { /* ignore */ }
        }
      }
    }
  }

  // Extract tool calls from assistant messages
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "toolCall" && part.name === "wiki_delegate_task") {
          delegateToolCalls.push({
            agent: part.arguments?.agent ?? "unknown",
            wikiRoot: part.arguments?.wikiRoot ?? "unknown",
          });
        }
      }
    }
  }

  await runtime.dispose();
  await agent.dispose();

  // Verify
  const calledAgent = delegateToolCalls[0]?.agent;
  const passed = calledAgent === c.expectedAgent;
  const details = passed
    ? [`✓ called ${calledAgent} agent`]
    : [
        `✗ expected agent=${c.expectedAgent}, got ${calledAgent ?? "(not called)"}`,
        `  delegate calls: ${JSON.stringify(delegateToolCalls)}`,
      ];

  return {
    name: c.name,
    expectedAgent: c.expectedAgent,
    delegateToolCalls,
    passed,
    details,
  };
}

async function main() {
  // Clean and init benchmark wiki
  try {
    rmSync(BENCH_ROOT, { recursive: true, force: true });
  } catch { /* ignore */ }
  await ensureWiki(BENCH_ROOT);

  // Create index
  writeFileSync(join(WIKI_DIR, "index.md"), "# Wiki\n\n## Pages\n\n- [[Transformers]]\n");

  console.log("=".repeat(60));
  console.log("Delegate-task Instruction Following Benchmark");
  console.log("(main agent → delegate-task, mock subagent)");
  console.log("=".repeat(60));
  console.log();

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`Running: ${c.name}... `);
    try {
      const result = await runCase(c, BENCH_ROOT);
      results.push(result);
      console.log(result.passed ? "✓" : "✗");
      for (const d of result.details) {
        console.log(`  ${d}`);
      }
    } catch (e: any) {
      console.log(`✗ ERROR: ${e.message}`);
      results.push({
        name: c.name,
        expectedAgent: c.expectedAgent,
        delegateToolCalls: [],
        passed: false,
        details: [`ERROR: ${e.message}`],
      });
    }
  }

  console.log();
  console.log("-".repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const score = Math.round((passed / total) * 100);

  console.log(`Score: ${passed}/${total} (${score}%)`);

  // Write JSON report
  const report = {
    timestamp: new Date().toISOString(),
    score,
    passed,
    total,
    cases: results.map((r) => ({
      name: r.name,
      expectedAgent: r.expectedAgent,
      delegateToolCalls: r.delegateToolCalls,
      passed: r.passed,
      details: r.details,
    })),
  };

  const reportPath = join(process.cwd(), "benchmarks", "delegate-task-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log();
  console.log(`Report: ${reportPath}`);
}

main().catch(console.error);
