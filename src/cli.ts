#!/usr/bin/env bun
// CLI entry point — wiki agent
import { InteractiveMode } from "@mariozechner/pi-coding-agent";
import { WikiAgent } from "./core/agent.js";
import { createWikiTools } from "./tools/index.js";
import { ensureWiki } from "./core/init.js";
import { MAIN_ROLE_PROMPT } from "./prompts/roles.js";

function printHelp(): void {
  console.log(`
llm-wiki-agent — Wiki Knowledge Agent CLI

Usage:
  llm-wiki-agent --wiki <path>        Interactive mode (auto-inits if needed)
  echo "query" | llm-wiki-agent --wiki <path>   Pipeline query
  llm-wiki-agent --version            Show version
  llm-wiki-agent --help               Show this help

Options:
  --wiki, -w <path>     Wiki root directory (required)
  --version             Show version
  --help                Show this help

Examples:
  llm-wiki-agent --wiki ./my-wiki
  echo "What is React?" | llm-wiki-agent --wiki ./research
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

  // Self-healing: ensure all required files/dirs exist
  const { created } = await ensureWiki(wikiRoot);
  if (created.length > 0) {
    console.error(`Wiki ready at: ${wikiRoot}`);
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

  // Create agent and session
  const agent = new WikiAgent();
  const runtime = await agent.createSession(wikiRoot, {
    tools: createWikiTools(wikiRoot),
    appendSystemPrompt: [MAIN_ROLE_PROMPT],
  });

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
