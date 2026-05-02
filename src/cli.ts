#!/usr/bin/env bun
// CLI entry point — wiki agent
import { InteractiveMode, runPrintMode } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "fs";
import { WikiAgent } from "./core/agent.js";
import { ensureWiki } from "./core/init.js";

function printHelp(): void {
  console.log(`
llm-wiki-agent — Wiki Knowledge Agent CLI

Usage:
  llm-wiki-agent --wiki <path>        Interactive mode (auto-inits if needed)
  echo "query" | llm-wiki-agent --wiki <path>   Pipeline query
  llm-wiki-agent --wiki <path> --mode json --append-system-prompt <file> <task>  Subagent mode
  llm-wiki-agent --version            Show version
  llm-wiki-agent --help               Show this help

Options:
  --wiki, -w <path>     Wiki root directory (required)
  --mode <mode>        Output mode: interactive (default), json
  --role <role>        Subagent role (ingest/query/lint), loads prompt from agents/wiki-<role>.md
  --tools <list>       Comma-separated built-in tool allowlist (e.g. read,bash,grep)
  --append-system-prompt <file>  Append file contents to system prompt (can repeat)
  --version             Show version
  --help                Show this help

Examples:
  llm-wiki-agent --wiki ./my-wiki
  echo "What is React?" | llm-wiki-agent --wiki ./research
  llm-wiki-agent --wiki ./wiki --mode json --append-system-prompt ./agents/wiki-query.md "search for ai agents"
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--version")) {
    console.log("llm-wiki-agent v0.1.0");
    return;
  }

  // Parse --wiki / -w
  const wikiIndex = args.indexOf("--wiki");
  const wikiShortIndex = args.indexOf("-w");
  const wikiRoot = wikiIndex !== -1
    ? args[wikiIndex + 1]
    : wikiShortIndex !== -1
      ? args[wikiShortIndex + 1]
      : undefined;

  if (!wikiRoot) {
    console.error("Error: --wiki is required");
    printHelp();
    process.exit(1);
  }

  // Parse --mode
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex !== -1 ? args[modeIndex + 1] : undefined;
  const isJsonMode = mode === "json";

  // Parse --append-system-prompt (can repeat)
  const appendPromptFiles: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--append-system-prompt" && i + 1 < args.length) {
      appendPromptFiles.push(args[i + 1]);
      i++;
    }
  }

  // Parse --tools (tool allowlist for subagent processes)
  const toolsIndex = args.indexOf("--tools");
  const toolsAllowlist = toolsIndex !== -1 && args[toolsIndex + 1]
    ? args[toolsIndex + 1].split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;
  const toolsValue = toolsAllowlist ? args[toolsIndex + 1] : undefined;

  // Parse --role (subagent role, e.g. "ingest")
  const roleIndex = args.indexOf("--role");
  const role = roleIndex !== -1 ? args[roleIndex + 1] : undefined;

  // Merge appended system prompt contents
  const appendedPrompts: string[] = [];
  for (const filePath of appendPromptFiles) {
    try {
      const content = readFileSync(filePath, "utf-8");
      appendedPrompts.push(content);
    } catch {
      // ignore missing files
    }
  }

  // Self-healing: ensure all required files/dirs exist
  const { created } = await ensureWiki(wikiRoot);
  if (created.length > 0) {
    console.error(`Wiki ready at: ${wikiRoot}`);
  }

  // Create agent and session
  const agent = new WikiAgent();
  const runtime = await agent.createSession(wikiRoot, {
    role,
    appendSystemPrompt: appendedPrompts,
    allowedTools: toolsAllowlist,
  });

  // Get positional task (for --mode json)
  // Known options that take a value: --wiki, --mode, --append-system-prompt, --tools, --role
  const knownOptionValues = new Set([wikiRoot, mode, ...appendPromptFiles, toolsValue, role].filter(Boolean as unknown as (v: unknown) => v is string));
  const positionalIndex = args.findIndex((a) =>
    !a.startsWith("-") && !knownOptionValues.has(a)
  );
  const positionalTask = positionalIndex !== -1 ? args.slice(positionalIndex).join(" ") : undefined;

  // JSON mode: run with positional task
  if (isJsonMode && positionalTask) {
    await runPrintMode(runtime, { mode: "json", initialMessage: positionalTask });
    await runtime.dispose();
    await agent.dispose();
    return;
  }

  // Read piped stdin for query
  let pipedQuery: string | undefined;
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    pipedQuery = Buffer.concat(chunks).toString("utf-8").trim();
  }

  if (pipedQuery) {
    // PrintMode: piped query via AgentSession
    const session = runtime.session;
    await session.prompt(pipedQuery);
    await new Promise(r => setTimeout(r, 1000));

    const messages = session.state.messages;
    for (const msg of messages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            process.stdout.write(part.text);
          }
        }
      }
    }
    console.log();
    await runtime.dispose();
  } else {
    // InteractiveMode: TUI
    const mode = new InteractiveMode(runtime);
    await mode.run();
  }

  await agent.dispose();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
