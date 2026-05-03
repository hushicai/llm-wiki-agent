// tests/server.test.ts — HTTP server integration tests
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { WikiAgent } from "../src/core/agent.js";
import { WebSessionManager } from "../src/server/session.js";
import { ensureWiki } from "../src/core/init.js";
import { parseServerArgs } from "../src/server.js";
import type { AgentSessionEvent, AgentSessionRuntime } from "@mariozechner/pi-coding-agent";

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
          const body = (await req.json()) as { message?: string };
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

              const unsubscribe = runtime.session.subscribe((event: AgentSessionEvent) => {
                if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
                  send(JSON.stringify({ type: "delta", content: event.assistantMessageEvent.delta }));
                } else if (event.type === "message_end") {
                  send(JSON.stringify({ type: "end", session_id: id }));
                }
              });

              send(JSON.stringify({ type: "session_id", id }));
              runtime.session.prompt(body.message ?? "").catch((err: Error) => {
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

        // Static file
        if (url.pathname === "/" || url.pathname === "/index.html") {
          const content = await Bun.file(join(webDir, "index.html")).text();
          return new Response(content, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        return new Response("Not Found", { status: 404 });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: message }), {
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
    port = server.port ?? 0;
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
    // Mock the session to fire events synchronously in subscribe
    const mockSession = {
      subscribe: (handler: (event: AgentSessionEvent) => void) => {
        // Fire all expected events synchronously
        handler({ type: "message_update", assistantMessageEvent: { type: "text_delta" as const, contentIndex: 0, delta: "你好", partial: {} as any } } as unknown as AgentSessionEvent);
        handler({ type: "message_update", assistantMessageEvent: { type: "text_delta" as const, contentIndex: 0, delta: "！", partial: {} as any } } as unknown as AgentSessionEvent);
        handler({ type: "message_end", message: { role: "assistant", content: [], timestamp: Date.now() } } as unknown as AgentSessionEvent);
        return () => {};
      },
      prompt: async (_msg: string) => {
        await new Promise(r => setTimeout(r, 50));
      },
    };

    // Mock sessionManager.create to return our mock
    const session_id = crypto.randomUUID();
    sessionManager.create = async () => ({
      id: session_id,
      runtime: { session: mockSession } as unknown as AgentSessionRuntime,
    });

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
    let hasDelta = false;
    let hasEnd = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      data += decoder.decode(value, { stream: true });
      if (data.includes('"type":"session_id"')) hasSessionId = true;
      if (data.includes('"type":"delta"')) hasDelta = true;
      if (data.includes('"type":"end"')) hasEnd = true;
    }

    expect(hasSessionId).toBe(true);
    expect(hasDelta).toBe(true);
    expect(hasEnd).toBe(true);
  });

  test("GET /unknown returns 404", async () => {
    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});

describe("parseServerArgs", () => {
  test("returns defaults with empty args", () => {
    const result = parseServerArgs([]);
    expect(result.port).toBe(3000);
    expect(result.host).toBe("0.0.0.0");
    expect(result.wikiRoot).toBe(process.cwd());
  });

  test("parses --wiki flag", () => {
    const result = parseServerArgs(["--wiki", "/tmp/test-wiki"]);
    expect(result.wikiRoot).toBe("/tmp/test-wiki");
  });

  test("parses -w short flag", () => {
    const result = parseServerArgs(["-w", "/tmp/test-wiki"]);
    expect(result.wikiRoot).toBe("/tmp/test-wiki");
  });

  test("parses --port flag", () => {
    const result = parseServerArgs(["--port", "8080"]);
    expect(result.port).toBe(8080);
  });

  test("parses -p short flag", () => {
    const result = parseServerArgs(["-p", "9090"]);
    expect(result.port).toBe(9090);
  });

  test("parses --host flag", () => {
    const result = parseServerArgs(["--host", "127.0.0.1"]);
    expect(result.host).toBe("127.0.0.1");
  });

  test("parses multiple flags", () => {
    const result = parseServerArgs(["--wiki", "/data/wiki", "--port", "4000", "--host", "0.0.0.0"]);
    expect(result.wikiRoot).toBe("/data/wiki");
    expect(result.port).toBe(4000);
    expect(result.host).toBe("0.0.0.0");
  });
});
