#!/usr/bin/env bun
// CLI entry point — wiki agent
import { InteractiveMode } from "@mariozechner/pi-coding-agent";
import { createWikiSession } from "./runtime.js";
import { initWiki, isWikiInitialized } from "./init.js";
import { existsSync } from "fs";

function printHelp(): void {
  console.log(`
llm-wiki-agent — Wiki Knowledge Agent CLI

Usage:
  wiki --wiki <path> [query]    Run query or start interactive mode
  wiki --wiki <path> --init     Initialize wiki
  wiki --version                Show version
  wiki --help                   Show this help

Options:
  --wiki, -w <path>     Wiki root directory (required)
  --init, -i            Initialize wiki if not exists
  --version             Show version
  --help                Show this help

Examples:
  wiki --wiki ./my-wiki "What is React?"
  wiki --wiki ./research --init
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

  // Handle --init
  if (args.includes("--init") || args.includes("-i")) {
    if (!existsSync(wikiRoot)) {
      await initWiki(wikiRoot);
      console.log(`Wiki initialized at: ${wikiRoot}`);
    } else if (!(await isWikiInitialized(wikiRoot))) {
      await initWiki(wikiRoot);
      console.log(`Wiki initialized at: ${wikiRoot}`);
    } else {
      console.log(`Wiki already initialized at: ${wikiRoot}`);
    }
    return;
  }

  // Ensure wiki is initialized
  if (!existsSync(wikiRoot) || !(await isWikiInitialized(wikiRoot))) {
    console.error(`Error: Wiki not found or not initialized at: ${wikiRoot}`);
    console.error("Use --init to create one.");
    process.exit(1);
  }

  // Extract query from positional args
  const positionalArgs = args.filter(
    (a) => !a.startsWith("-") && a !== wikiRoot
  );
  const query = positionalArgs.join(" ");

  // Create wiki session runtime
  const runtime = await createWikiSession({ wikiRoot });

  if (query) {
    // PrintMode: single query via AgentSession (supports tools)
    const session = runtime.session;
    await session.prompt(query);

    // Wait briefly for agent to finish
    await new Promise(r => setTimeout(r, 1000));

    // Extract and print response text
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
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
