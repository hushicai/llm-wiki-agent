// tests/server.test.ts — HTTP server integration tests
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { WikiAgent } from "../src/core/agent.js";
import { WebSessionManager } from "../src/server/session.js";
import { ensureWiki } from "../src/core/init.js";

const testDir = join(tmpdir(), "llm-wiki-agent-server-test");
const wikiRoot = join(testDir, "wiki");
const webDir = join(testDir, "web");

let agent: WikiAgent;
let sessionManager: WebSessionManager;

// Minimal server for testing
function startTestServer(port: number) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      try {
        // POST /api/chat
        if (url.pathname === "/api/chat" && req.method === "POST") {
          const body = (await req.json()) as any;
          if (!body.message) {
            return new Response(JSON.stringify({ error: "message is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const { id, runtime } = await sessionManager.create(agent, wikiRoot);

          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              let closed = false;
              const send = (data: string) => {
                if (!closed) controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              };

              const unsubscribe = runtime.session.subscribe((event: any) => {
                if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
                  send(JSON.stringify({ type: "delta", content: event.assistantMessageEvent.delta }));
                } else if (event.type === "message_end") {
                  send(JSON.stringify({ type: "end", session_id: id }));
                }
              });

              send(JSON.stringify({ type: "session_id", id }));
              runtime.session.prompt(body.message).catch((err: Error) => {
                send(JSON.stringify({ type: "error", message: err.message }));
              }).finally(() => {
                unsubscribe();
                closed = true;
                controller.close();
              });
            },
          });

          return new Response(stream, {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          });
        }

        // GET /api/models
        if (url.pathname === "/api/models") {
          return new Response(JSON.stringify({ models: agent.getModels() }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Static file
        if (url.pathname === "/" || url.pathname === "/index.html") {
          const content = await Bun.file(join(webDir, "index.html")).text();
          return new Response(content, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        return new Response("Not Found", { status: 404 });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  });
}

describe("HTTP Server", () => {
  let server: ReturnType<typeof Bun.serve>;
  let port: number;

  beforeAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(webDir, { recursive: true });
    await ensureWiki(wikiRoot);

    // Create a test index.html
    await writeFile(join(webDir, "index.html"), "<html><body>Test Wiki</body></html>");

    agent = new WikiAgent();
    sessionManager = new WebSessionManager();
    server = startTestServer(0); // random port
    port = server.port;
  });

  afterAll(async () => {
    server.stop();
    sessionManager.dispose();
    await agent.dispose();
    await rm(testDir, { recursive: true, force: true });
  });

  test("GET / returns index.html", async () => {
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Test Wiki");
  });

  test("GET /api/models returns JSON", async () => {
    const res = await fetch(`http://localhost:${port}/api/models`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("models");
    expect(Array.isArray(data.models)).toBe(true);
  });

  test("POST /api/chat without message returns 400", async () => {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("message");
  });

  test("POST /api/chat returns SSE stream", async () => {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "你好" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let data = "";
    let hasSessionId = false;
    let hasEnd = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      data += decoder.decode(value, { stream: true });
      if (data.includes('"type":"session_id"')) hasSessionId = true;
      if (data.includes('"type":"end"')) hasEnd = true;
    }

    expect(hasSessionId).toBe(true);
  });

  test("GET /unknown returns 404", async () => {
    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});
