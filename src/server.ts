#!/usr/bin/env bun
// src/server.ts — Web UI server for llm-wiki-agent
import { WikiAgent } from "./core/agent.js";
import { WebSessionManager } from "./server/session.js";
import { ensureWiki } from "./core/init.js";
import { join, extname } from "path";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function parseArgs() {
  const args = process.argv.slice(2);
  let wikiRoot = process.cwd();
  let port = 3000;
  let host = "0.0.0.0";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--wiki" || args[i] === "-w") wikiRoot = args[++i];
    else if (args[i] === "--port" || args[i] === "-p")
      port = parseInt(args[++i], 10);
    else if (args[i] === "--host") host = args[++i];
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`llm-wiki-agent server

Usage: bun run src/server.ts [options]

Options:
  --wiki, -w <path>   Wiki root directory (default: cwd)
  --port, -p <number> HTTP port (default: 3000)
  --host <address>    Listen address (default: 0.0.0.0)
  --help              Show this help`);
      process.exit(0);
    }
  }
  return { wikiRoot, port, host };
}

async function main() {
  const { wikiRoot, port, host } = parseArgs();

  // Initialize wiki
  const { created } = await ensureWiki(wikiRoot);
  if (created.length > 0) {
    console.error(`Wiki ready at: ${wikiRoot}`);
  }

  // Create agent and session manager
  const agent = new WikiAgent();
  const sessionManager = new WebSessionManager();

  // Determine web/ directory path (relative to this file: src/server.ts → ../web)
  const webDir = new URL("../web", import.meta.url).pathname;

  Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);

      try {
        // POST /api/chat — SSE streaming
        if (url.pathname === "/api/chat" && req.method === "POST") {
          const body = (await req.json()) as any;
          const message = body.message;
          const sessionId = body.session_id;

          if (!message || typeof message !== "string") {
            return new Response(
              JSON.stringify({ error: "message is required" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          // Get or create session
          let runtime: any;
          let sid = sessionId;
          if (sid) {
            runtime = sessionManager.get(sid);
          }
          if (!runtime) {
            const created = await sessionManager.create(agent, wikiRoot);
            sid = created.id;
            runtime = created.runtime;
          }

          // SSE response
          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              let closed = false;

              const send = (data: string) => {
                if (!closed) {
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                }
              };

              // Subscribe to agent events
              const unsubscribe = runtime.session.subscribe((event: any) => {
                if (
                  event.type === "message_update" &&
                  event.assistantMessageEvent?.type === "text_delta"
                ) {
                  send(
                    JSON.stringify({
                      type: "delta",
                      content: event.assistantMessageEvent.delta,
                    }),
                  );
                } else if (event.type === "message_end") {
                  send(JSON.stringify({ type: "end", session_id: sid }));
                } else if (event.type === "tool_execution_start") {
                  send(
                    JSON.stringify({
                      type: "tool",
                      name: event.toolName,
                      args: event.args,
                    }),
                  );
                } else if (event.type === "tool_execution_end") {
                  send(
                    JSON.stringify({
                      type: "tool_result",
                      name: event.toolName,
                    }),
                  );
                }
              });

              // Send session_id first
              send(JSON.stringify({ type: "session_id", id: sid }));

              // Start agent prompt
              runtime.session
                .prompt(message)
                .catch((err: Error) => {
                  send(JSON.stringify({ type: "error", message: err.message }));
                })
                .finally(() => {
                  unsubscribe();
                  closed = true;
                  controller.close();
                });
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }

        // GET /api/models
        if (url.pathname === "/api/models" && req.method === "GET") {
          const models = agent.getModels();
          return new Response(JSON.stringify({ models }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Static files
        const filePath =
          url.pathname === "/" ? "/index.html" : url.pathname;
        const fullPath = join(webDir, filePath);

        // Security: prevent path traversal
        if (!fullPath.startsWith(webDir)) {
          return new Response("Forbidden", { status: 403 });
        }

        if (!existsSync(fullPath)) {
          return new Response("Not Found", { status: 404 });
        }

        const content = await readFile(fullPath);
        const mime =
          MIME_TYPES[extname(filePath)] || "application/octet-stream";
        return new Response(content, { headers: { "Content-Type": mime } });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  });

  console.error(`llm-wiki-agent server running at http://${host}:${port}`);
  console.error(`Wiki root: ${wikiRoot}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
