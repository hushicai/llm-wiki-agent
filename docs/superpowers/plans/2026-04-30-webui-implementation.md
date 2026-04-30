# Web UI + WikiAgent 实现计划

> **Goal:** 抽象 WikiAgent 作为核心接口，所有入口统一消费它，再基于它实现 HTTP server + 前端。

**架构：**

```
src/
├── cli.ts              ← CLI 入口（改为使用 agent）
├── server.ts           ← HTTP server（新增）
├── core/               ← 核心：agent + 基础设施
│   ├── agent.ts        ← WikiAgent（新增）
│   ├── runtime.ts      ← createWikiSession（被 agent 调用）
│   ├── config.ts       ← 路径管理
│   ├── frontmatter.ts  ← frontmatter 工具
│   └── init.ts         ← wiki 初始化
├── server/
│   └── session.ts      ← Web 会话管理（新增）
├── tools/
│   ├── index.ts
│   ├── wiki-read.ts
│   ├── wiki-write.ts
│   ├── wiki-search.ts
│   ├── wiki-list.ts
│   ├── wiki-ingest.ts
│   └── wiki-lint.ts
├── templates/
│   ├── system-prompt-template.md
│   └── wiki-schema-template.md
└── types.ts            ← 类型定义
web/
└── index.html          ← 前端（新增）
```

**Tech Stack:** Bun, TypeScript, pi-coding-agent SDK, SSE

---

## Phase 1: WikiAgent 抽象

### Task 1: 创建 core/agent.ts

**Objective:** 实现 WikiAgent 类，包装 createWikiSession()，管理配置和模板。

**Files:**
- Create: `src/core/agent.ts`

**实现：**

```typescript
// src/core/agent.ts — WikiAgent: core abstraction for llm-wiki-agent
import { createAgentSession, createAgentSessionRuntime, createAgentSessionServices, SessionManager } from "@mariozechner/pi-coding-agent";
import { existsSync } from "fs";
import { join } from "path";
import { getAgentDir, getSessionDir, slugify } from "./config.js";

export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow?: number;
}

export class WikiAgent {
  private agentDir: string;
  private systemPromptLines: string[];
  private cachedModels: ModelInfo[] | null;

  constructor() {
    this.agentDir = getAgentDir();
    this.systemPromptLines = this.loadSystemPromptSync();
    this.cachedModels = null;
  }

  private loadSystemPromptSync(): string[] {
    try {
      const promptPath = new URL("../templates/system-prompt-template.md", import.meta.url).pathname;
      const fs = require("fs");
      const content = fs.readFileSync(promptPath, "utf-8");
      return ["", ...content.split("\n"), ""];
    } catch {
      return [];
    }
  }

  async createSession(wikiRoot: string) {
    const wikiSlug = slugify(wikiRoot.split("/").pop() || "wiki");
    const sessionDir = getSessionDir(wikiSlug);
    const sessionManager = SessionManager.create(wikiRoot, sessionDir);

    const svc = await createAgentSessionServices({
      cwd: wikiRoot,
      agentDir: this.agentDir,
      resourceLoaderOptions: {
        noSkills: true,
        appendSystemPrompt: this.systemPromptLines,
        ...(existsSync(join(this.agentDir, "skills")) && {
          additionalSkillPaths: [join(this.agentDir, "skills")],
        }),
      },
    });

    // Cache model info for getModels()
    if (!this.cachedModels) {
      this.cachedModels = svc.modelRegistry.getAvailable().map((m: any) => ({
        id: m.id,
        provider: m.provider,
        contextWindow: m.contextWindow,
      }));
    }

    // Fire-and-forget context window probe
    this.probeContextWindows(svc);

    const runtime = await createAgentSessionRuntime(
      async (opts: any) => {
        const result = await createAgentSession({
          ...opts,
          agentDir: this.agentDir,
          resourceLoader: svc.resourceLoader,
          modelRegistry: svc.modelRegistry,
          sessionManager,
        });
        return { ...result, services: svc, diagnostics: svc.diagnostics };
      },
      { cwd: wikiRoot, agentDir: this.agentDir, sessionManager }
    );

    return runtime;
  }

  getModels(): ModelInfo[] {
    return this.cachedModels ?? [];
  }

  private async probeContextWindows(svc: any): Promise<void> {
    const DEFAULT_CTX = 128000;
    const registry = svc.modelRegistry;
    const models = registry.getAvailable();
    const providerModels = new Map<string, any[]>();

    for (const m of models) {
      if (m.contextWindow && m.contextWindow !== DEFAULT_CTX) continue;
      const list = providerModels.get(m.provider) ?? [];
      list.push(m);
      providerModels.set(m.provider, list);
    }

    for (const [provider, list] of providerModels) {
      if (list.length === 0) continue;
      const baseUrl = list[0].baseUrl;
      if (!baseUrl) continue;
      const auth = await registry.getApiKeyAndHeaders(list[0]);
      if (!auth.ok) continue;

      try {
        const url = baseUrl.replace(/\/+$/, "") + "/models";
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (auth.apiKey) headers["Authorization"] = `Bearer ${auth.apiKey}`;
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(1000) });
        if (!response.ok) continue;
        const data = await response.json() as any;
        const modelList: any[] = data?.data ?? [];
        for (const entry of modelList) {
          const ctxLen = entry?.meta?.context_length ?? entry?.context_window;
          if (!ctxLen) continue;
          const match = list.find((m: any) => m.id === entry.id);
          if (match && (!match.contextWindow || match.contextWindow === DEFAULT_CTX)) {
            (match as any).contextWindow = ctxLen;
          }
        }
      } catch { /* timeout — use default */ }
    }
  }

  async dispose(): Promise<void> {
    this.cachedModels = null;
  }
}
```

**Verify:** `bun run build` 编译通过。

---

### Task 2: 改造 cli.ts 使用 WikiAgent

**Objective:** CLI 和管道模式改为通过 WikiAgent 创建 session。

**Files:**
- Modify: `src/cli.ts`

**变更：**

```diff
- import { createWikiSession } from "./core/runtime.js";
+ import { WikiAgent } from "./core/agent.js";

  async function main(): Promise<void> {
+   const agent = new WikiAgent();
    // ... 参数解析 ...
    await ensureWiki(wikiRoot);
-   const runtime = await createWikiSession({ wikiRoot });
+   const runtime = await agent.createSession(wikiRoot);

    // pipeline 和交互模式不变
    // ...

+   await agent.dispose();
  }
```

**Verify:** `bun test` 通过（原有测试仍用 createWikiSession，不受影响）。

---

### Task 3: 验证 CLI 仍正常工作

**Objective:** 确认改造后 CLI 和管道模式不崩溃。

**Verify:**
```bash
bun run build
bun test
# 手动：bun run src/cli.ts --help 显示帮助
```

---

## Phase 2: Server 模块

### Task 4: 创建 server/session.ts

**Objective:** Web 会话管理，管理多个并发的 agent session。

**Files:**
- Create: `src/server/session.ts`

```typescript
// src/server/session.ts — Web session manager
import type { WikiAgent } from "../core/agent.js";

interface SessionEntry {
  runtime: any;  // AgentSessionRuntime
  createdAt: number;
  lastActivity: number;
}

export class WebSessionManager {
  private sessions = new Map<string, SessionEntry>();
  private cleanupTimer: Timer | null = null;
  private readonly TTL_MS = 30 * 60 * 1000; // 30 min

  constructor() {
    // Periodic cleanup every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  async create(agent: WikiAgent, wikiRoot: string): Promise<{ id: string; runtime: any }> {
    const id = crypto.randomUUID();
    const runtime = await agent.createSession(wikiRoot);
    const now = Date.now();
    this.sessions.set(id, { runtime, createdAt: now, lastActivity: now });
    return { id, runtime };
  }

  get(id: string): any | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    entry.lastActivity = Date.now();
    return entry.runtime;
  }

  async remove(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (entry) {
      await entry.runtime.dispose();
      this.sessions.delete(id);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastActivity > this.TTL_MS) {
        entry.runtime.dispose().catch(() => {});
        this.sessions.delete(id);
      }
    }
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const [id, entry] of this.sessions) {
      entry.runtime.dispose().catch(() => {});
    }
    this.sessions.clear();
  }
}
```

---

### Task 5: 创建 server.ts

**Objective:** Bun HTTP server，提供 API 和静态文件服务。

**Files:**
- Create: `src/server.ts`

```typescript
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
    else if (args[i] === "--port" || args[i] === "-p") port = parseInt(args[++i], 10);
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

  // Determine web/ directory path
  const webDir = new URL("../web", import.meta.url).pathname;

  Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);

      try {
        // POST /api/chat — SSE streaming
        if (url.pathname === "/api/chat" && req.method === "POST") {
          const body = await req.json() as any;
          const message = body.message;
          const sessionId = body.session_id;

          if (!message || typeof message !== "string") {
            return new Response(JSON.stringify({ error: "message is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
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
                if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
                  send(JSON.stringify({ type: "delta", content: event.assistantMessageEvent.delta }));
                } else if (event.type === "message_end") {
                  send(JSON.stringify({ type: "end", session_id: sid }));
                } else if (event.type === "tool_execution_start") {
                  send(JSON.stringify({ type: "tool", name: event.toolName, args: event.args }));
                } else if (event.type === "tool_execution_end") {
                  send(JSON.stringify({ type: "tool_result", name: event.toolName }));
                }
              });

              // Send session_id first
              send(JSON.stringify({ type: "session_id", id: sid }));

              // Start agent prompt
              runtime.session.prompt(message).catch((err: Error) => {
                send(JSON.stringify({ type: "error", message: err.message }));
              }).finally(() => {
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
              "Connection": "keep-alive",
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
        const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
        const fullPath = join(webDir, filePath);

        // Security: prevent path traversal
        if (!fullPath.startsWith(webDir)) {
          return new Response("Forbidden", { status: 403 });
        }

        if (!existsSync(fullPath)) {
          return new Response("Not Found", { status: 404 });
        }

        const content = await readFile(fullPath);
        const mime = MIME_TYPES[extname(filePath)] || "application/octet-stream";
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
```

---

### Task 6: 创建 web/index.html

**Objective:** 单 HTML 文件前端，SSE 流式聊天 UI。

**Files:**
- Create: `web/index.html`

约 300 行，单 HTML 文件，vanilla JS，暗色主题。
- SSE 接收 delta/tool/end/error 事件
- 消息列表 + 输入框
- 简单 Markdown 渲染
- 模型选择器
- Enter 发送

---

### Task 7: 更新 package.json

**Objective:** 添加 serve script。

```diff
  "scripts": {
    "start": "bun run src/cli.ts",
    "serve": "bun run src/server.ts --wiki ~/my-wiki",
    "build": "bun build src/cli.ts --outdir dist --target bun",
    "test": "bun test"
  }
```

---

## Phase 3: 测试

### Task 8: 创建 agent.test.ts

**Objective:** 测试 WikiAgent 基本功能。

```typescript
// tests/agent.test.ts
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { WikiAgent } from "../src/core/agent.js";
import { ensureWiki } from "../src/core/init.js";

describe("WikiAgent", () => {
  const testDir = join(tmpdir(), "llm-wiki-agent-agent-test");
  const wikiRoot = join(testDir, "wiki");

  beforeAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    await ensureWiki(wikiRoot);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("constructs without error", () => {
    const agent = new WikiAgent();
    expect(agent).toBeDefined();
  });

  test("creates session", async () => {
    const agent = new WikiAgent();
    const runtime = await agent.createSession(wikiRoot);
    expect(runtime).toBeDefined();
    expect(runtime.session).toBeDefined();
    await runtime.dispose();
  });

  test("getModels returns array", () => {
    const agent = new WikiAgent();
    const models = agent.getModels();
    expect(Array.isArray(models)).toBe(true);
  });

  test("dispose is idempotent", async () => {
    const agent = new WikiAgent();
    await agent.dispose();
    await agent.dispose();
  });
});
```

### Task 9: 创建 server.test.ts

**Objective:** 测试 server API 端点。

- 测试 GET /api/models 返回 JSON
- 测试 POST /api/chat 返回 SSE
- 测试 404 路由
- 测试静态文件服务

---

## 执行顺序

```
Task 1: core/agent.ts       → 核心抽象
Task 2: cli.ts 改造         → 使用 agent
Task 3: 验证 CLI            → 确保不崩
Task 4: server/session.ts   → 会话管理
Task 5: server.ts           → HTTP server
Task 6: web/index.html      → 前端
Task 7: package.json        → serve script
Task 8: agent.test.ts       → agent 测试
Task 9: server.test.ts      → server 测试
```
