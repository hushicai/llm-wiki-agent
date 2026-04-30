# llm-wiki-agent Web UI 模块设计

为 llm-wiki-agent 添加 Web UI 模块。先抽象 `WikiAgent` 作为核心接口，所有入口（CLI、管道、Server）统一消费它，再基于它实现 HTTP server。

---

## 1. 分层架构

### 现状

```
createWikiSession() — 一个函数做所有事：配置加载 + session 创建 + 模板加载 + 上下文探测
  ├── cli.ts      直接调
  ├── pipeline    直接调
  └── server      也会直接调（耦合）
```

问题：`createWikiSession()` 没有分层，配置管理、模板加载、session 创建混在一起。

### 目标

```
WikiAgent（核心抽象，进程内加载一次）
  ├── 配置管理：~/.llm-wiki-agent/（models.json, settings.json, auth.json）
  ├── 模板加载：system-prompt-template.md（加载一次）
  ├── createSession(wikiRoot) → AgentSessionRuntime
  └── getModels() → ModelInfo[]

CLI:     new WikiAgent() → agent.createSession(wikiRoot) → InteractiveMode
Pipeline: new WikiAgent() → agent.createSession(wikiRoot) → session.prompt()
Server:  new WikiAgent() → agent.createSession(wikiRoot) → SSE streaming
```

### 设计原则

| 原则 | 说明 |
|------|------|
| 一次构造 | WikiAgent 在进程启动时构造一次，加载配置和模板 |
| 按 wiki 创建 session | `createSession(wikiRoot)` 每次创建一个绑定到特定 wiki 的 session |
| 配置内部管理 | WikiAgent 内部管理 `~/.llm-wiki-agent/`，不对外暴露 |
| 消费者无感知 | CLI/管道/Server 只看到 `WikiAgent` 接口，不关心内部实现 |

---

## 2. WikiAgent 接口

```typescript
// src/agent.ts

class WikiAgent {
  constructor()
  // 加载 ~/.llm-wiki-agent/ 配置
  // 加载 system-prompt-template.md
  // 初始化 model registry

  /** 创建绑定到 wiki 根目录的 agent session */
  async createSession(wikiRoot: string): Promise<AgentSessionRuntime>

  /** 列出可用模型 */
  getModels(): ModelInfo[]

  /** 释放所有资源 */
  async dispose(): Promise<void>
}
```

### 内部实现

WikiAgent 包装当前的 `createWikiSession()` 逻辑，但将配置/模板加载提升到构造阶段：

```typescript
class WikiAgent {
  private agentDir: string;
  private systemPromptLines: string[];
  private modelRegistry: ModelRegistry | null;

  constructor() {
    this.agentDir = getAgentDir();
    this.systemPromptLines = this.loadSystemPrompt();
    this.modelRegistry = null; // 首次 createSession 时初始化
  }

  async createSession(wikiRoot: string): Promise<AgentSessionRuntime> {
    // 1. 计算 session 路径
    const wikiSlug = slugify(...);
    const sessionDir = getSessionDir(wikiSlug);
    const sessionManager = SessionManager.create(wikiRoot, sessionDir);

    // 2. 创建 agent services（复用 this.agentDir, this.systemPromptLines）
    const svc = await createAgentSessionServices({
      cwd: wikiRoot,
      agentDir: this.agentDir,
      resourceLoaderOptions: {
        noSkills: true,
        appendSystemPrompt: this.systemPromptLines,
        additionalSkillPaths: existsSync(skillsDir) ? [skillsDir] : undefined,
      },
    });

    // 3. 缓存 model registry（供 getModels() 使用）
    if (!this.modelRegistry) {
      this.modelRegistry = svc.modelRegistry;
    }

    // 4. 上下文窗口探测
    probeContextWindows(svc, 128000);

    // 5. 创建 runtime
    const runtime = await createAgentSessionRuntime(
      async (opts) => {
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
    return this.modelRegistry?.getAvailable() ?? [];
  }
}
```

### 文件变更

```diff
 src/
+├── cli.ts                   ← CLI 入口（改为使用 WikiAgent）
+├── server.ts                ← 新增：HTTP server
+├── core/
+│   ├── agent.ts             ← 新增：WikiAgent 类
+│   ├── runtime.ts           ← createWikiSession（内部函数）
+│   ├── config.ts            ← 路径管理
+│   ├── frontmatter.ts       ← frontmatter 工具
+│   └── init.ts              ← wiki 初始化
+├── server/
+│   └── session.ts           ← 新增：会话管理
+├── tools/                   ← 不变
+├── templates/               ← 不变
+└── types.ts                 ← 不变
```

---

## 3. CLI/Pipeline 改造

### cli.ts 变更

```diff
- import { createWikiSession } from "./runtime.js";
+ import { WikiAgent } from "./agent.js";

  async function main() {
+   const agent = new WikiAgent();
    const wikiRoot = parseArgs();
    await ensureWiki(wikiRoot);
-   const runtime = await createWikiSession({ wikiRoot });
+   const runtime = await agent.createSession(wikiRoot);

    if (pipedQuery) {
      // pipeline 模式
      await runtime.session.prompt(pipedQuery);
      // ... 输出结果
    } else {
      // 交互模式
      const mode = new InteractiveMode(runtime);
      await mode.run();
    }

+   await agent.dispose();
  }
```

改造量：约 5 行变更。`createWikiSession()` 的内部逻辑不变，只是调用方从直接调函数变成调 `WikiAgent` 的方法。

---

## 4. Server 模块

### 新增文件

```
llm-wiki-agent/
├── src/
│   ├── agent.ts          ← WikiAgent 类
│   ├── server.ts         ← Bun HTTP server + 路由
│   └── server-session.ts ← 会话管理
└── web/
    └── index.html        ← 聊天 UI 前端
```

### 4.1 `src/server.ts` — HTTP Server

**职责**：启动 Bun HTTP server，路由分发，静态文件服务。接收一个 `WikiAgent` 实例。

```typescript
function startServer(agent: WikiAgent, options: {
  wikiRoot: string;
  port: number;
  host: string;
}) {
  Bun.serve({
    port: options.port,
    hostname: options.host,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/chat" && req.method === "POST")
        return handleChat(req, agent, options.wikiRoot);
      if (url.pathname === "/api/models" && req.method === "GET")
        return handleModels(agent);
      if (url.pathname.startsWith("/api/"))
        return new Response("Not Found", { status: 404 });

      return serveStatic(url.pathname);
    },
  });
}
```

**API 端点**：

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| POST | `/api/chat` | `{ message, session_id? }` | SSE stream |
| GET | `/api/models` | — | JSON: `{ models: [...] }` |
| GET | `/` | — | `web/index.html` |
| GET | `/*` | — | `web/` 下的静态文件 |

### 4.2 `src/server-session.ts` — 会话管理

管理多个并发的 agent session，每个绑定一个 wiki 根目录。

```typescript
class WebSessionManager {
  private sessions: Map<string, AgentSessionRuntime>;

  create(agent: WikiAgent, wikiRoot: string): Promise<{ id: string; runtime: AgentSessionRuntime }>;
  get(id: string): AgentSessionRuntime | undefined;
  remove(id: string): Promise<void>;
}
```

- 每个 `POST /api/chat` 请求携带 `session_id`
- 首次请求时自动创建 session（无 `session_id` 时）
- session 超时自动清理（30 分钟无活动）

### 4.3 SSE 流式响应

**核心流程**：

```
POST /api/chat { message, session_id? }
  → WebSessionManager 创建/获取 AgentSessionRuntime
  → 设置 SSE headers (Content-Type: text/event-stream)
  → runtime.session.subscribe(listener)
  → runtime.session.prompt(message)
  → 事件循环：
    message_update + text_delta  → SSE: data: {"type":"delta","content":"..."}
    message_end                  → SSE: data: {"type":"end"}
    tool_execution_start         → SSE: data: {"type":"tool","name":"...","args":"..."}
    tool_execution_end           → SSE: data: {"type":"tool_result","result":"..."}
  → 流结束，关闭 SSE
```

**事件类型**：

| SSE event | 含义 | 前端处理 |
|-----------|------|---------|
| `delta` | 文本增量 | 追加到当前消息 |
| `tool` | 工具调用开始 | 显示工具调用提示 |
| `tool_result` | 工具调用结束 | 更新工具调用状态 |
| `end` | 回复完成 | 停止流式接收 |
| `error` | 错误 | 显示错误信息 |

### 4.4 `web/index.html` — 前端

单 HTML 文件，纯 vanilla JS，无外部依赖。

**UI 结构**：

```
┌─────────────────────────────┐
│  ⚙️ 设置  [模型选择 ▼]      │  顶部栏
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐    │
│  │ User: React是什么？ │    │  消息列表
│  ├─────────────────────┤    │
│  │ Assistant: React是  │    │
│  │ 一个JavaScript...   │    │
│  │ [🔍 wiki_search]    │    │  工具调用提示
│  └─────────────────────┘    │
│                             │
├─────────────────────────────┤
│  [输入消息...]       [发送] │  输入区
└─────────────────────────────┘
```

**功能**：
- 消息列表，SSE delta 实时追加
- 工具调用提示
- 简单的 Markdown 渲染（粗体、代码块、链接）
- 模型选择
- 暗色主题
- 自动滚动
- Enter 发送，Shift+Enter 换行

**非功能需求**：
- 无前端构建工具链
- 无外部 CDN 依赖
- 文件大小 < 50KB

---

## 5. 独立入口

Server 作为独立模块运行，接收 `WikiAgent` 实例。

```bash
bun run src/server.ts --wiki ~/my-wiki --port 3000
```

package.json 新增 script：

```json
{
  "scripts": {
    "serve": "bun run src/server.ts --wiki ~/my-wiki"
  }
}
```

Server 自己的 CLI 参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--wiki, -w` | 当前目录 | Wiki 根目录 |
| `--port, -p` | 3000 | HTTP 监听端口 |
| `--host` | 0.0.0.0 | 监听地址 |
| `--help` | — | 帮助信息 |

**启动流程**：

```
server.ts 启动
  → const agent = new WikiAgent()  // 加载配置 + 模板
  → startServer(agent, {
      wikiRoot: "~/my-wiki",
      port: 3000,
    })
  → 用户请求进来时：
      agent.createSession(wikiRoot)  // 创建 session
      → SSE streaming
```

---

## 6. 边界情况

| 场景 | 处理方式 |
|------|---------|
| 多个浏览器标签页 | 每个标签页独立 session_id，互不干扰 |
| 页面刷新 | session 丢失，自动创建新 session |
| 长时间无操作 | session 30 分钟超时自动清理 |
| 大消息 | SSE 分块传输，无内存堆积 |
| 网络断开 | 浏览器自动重连 SSE |
| 模型不可用 | SSE 返回 error 事件 |

---

## 7. 测试策略

| 测试 | 方法 |
|------|------|
| WikiAgent | 创建 session、列出模型、释放资源 |
| Server 路由 | Bun 测试 + 模拟 fetch |
| SSE 流式 | 测试事件序列正确性 |
| 会话管理 | 创建/获取/超时/清理 |
| 前端 | 手动测试 |

---

## 8. 实施计划

| 步骤 | 文件 | 工作量 |
|------|------|--------|
| 1. 实现 agent.ts | WikiAgent 类 | ~80 行 |
| 2. 改造 cli.ts | 改为使用 WikiAgent | ~10 行 |
| 3. 实现 server-session.ts | 会话管理 | ~50 行 |
| 4. 实现 server.ts | HTTP server + SSE | ~150 行 |
| 5. 实现 index.html | 前端 | ~300 行 |
| 6. 测试 | agent.test.ts + server.test.ts | ~100 行 |

总计：约 690 行新增/变更代码。runtime.ts 内部逻辑不变，调用方改为 WikiAgent。
