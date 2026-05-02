# llm-wiki-agent Subagent 架构设计

## 背景

当前 llm-wiki-agent 是一个单一 agent，所有工具（wiki_read/write/search/ingest/lint）平铺在主 session 中。问题：

- **工具集无法按需剪枝** — 主 agent 始终拥有所有工具，无法按任务类型限制能力边界
- **上下文窗口竞争** — ingest/lint 等耗时任务占用主 session 的上下文窗口，影响对话质量
- **System prompt 混用** — ingest 需要的指令和 query 需要的指令相互干扰

**目标**：主 agent 只负责任务分发，3 个 subagent 各司其职，工具集和 system prompt 完全隔离。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  主 Agent Session（WikiAgent 主 session）                     │
│                                                             │
│  工具集：仅 subagent 分发工具 wiki_dispatch                  │
│  System Prompt：Wiki 管理员，负责任务理解与分发                │
│  上下文窗口：对话管理 + 分发决策（不参与具体 wiki 操作）       │
└────────────────────┬────────────────────────────────────────┘
                     │ spawn 子进程
       ┌────────────┼────────────┐
       ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │  Ingest  │ │  Query   │ │  Lint    │
  │ Subagent │ │ Subagent │ │ Subagent │
  └────┬─────┘ └────┬─────┘ └────┬─────┘
       │            │            │
  tools:         tools:       tools:
  wiki_read    wiki_read    wiki_read
  wiki_write   wiki_search  wiki_write
  wiki_list    wiki_list    wiki_lint
               wiki_lint
  SysPrompt:   SysPrompt:   SysPrompt:
  ingest.md    query.md     lint.md
```

## 核心约束

| 约束 | 说明 |
|------|------|
| **完全隔离的上下文窗口** | 每个 subagent 是独立子进程，拥有独立内存上下文 |
| **可指定 system prompt** | CLI 支持 `--system-prompt <file>` 传入自定义 system prompt |
| **JSON 行流协议** | 子进程通过 stdout 输出 JSON 行流，主 agent 实时解析 |
| **内置工具读写 wikiroot** | Subagent 仅使用 wiki 内置工具，不使用 pi 内置的 read/write/grep 等 |

## Subagent 进程通信协议

### 主 Agent → Subagent（启动参数）

```bash
llm-wiki-agent --wiki <path> --role <ingest|query|lint> --query <task>
```

### Subagent → 主 Agent（stdout JSON 行流）

```json
{"type": "start", "role": "ingest", "timestamp": "..."}
{"type": "delta", "text": "正在分析源文件..."}
{"type": "tool", "name": "wiki_write", "args": {...}}
{"type": "tool_result", "name": "wiki_write", "success": true, "path": "wiki/..."}
{"type": "tool", "name": "wiki_read", "args": {"path": "..."}}
{"type": "tool_result", "name": "wiki_read", "success": true, "content": "..."}
{"type": "error", "message": "..."}
{"type": "end", "summary": "成功提取 3 个实体...", "pages_created": 3, "stderr": ""}
```

### 事件类型

| 事件 | 说明 |
|------|------|
| `start` | subagent 启动 |
| `delta` | 文本增量（流式输出） |
| `tool` | 工具调用开始 |
| `tool_result` | 工具调用结果 |
| `error` | 错误发生 |
| `end` | 执行完成（含 summary 和统计） |

### 错误处理

| 场景 | 处理方式 |
|------|---------|
| 子进程非零退出码 | `end` 事件的 `exitCode` 字段标记，`stderr` 包含错误输出 |
| 子进程崩溃 | 主 agent 通过 `proc.on('error')` 捕获，返回 `{ type: 'error', message: '...' }` |
| 超时 | 通过 `--timeout` 参数控制，默认 5 分钟 |
| AbortSignal | 主 agent 可取消子进程（SIGTERM → 5s → SIGKILL） |

## 组件设计

### 1. CLI 改造（`src/cli.ts`）

新增参数：

```bash
llm-wiki-agent --wiki <path> --role <role> --query <task> [--system-prompt <file>] [--timeout <seconds>]
```

| 参数 | 说明 |
|------|------|
| `--role` | subagent 角色：`ingest`、`query`、`lint` |
| `--query` | 任务描述 |
| `--system-prompt` | 可选，自定义 system prompt 文件路径 |
| `--timeout` | 超时秒数，默认 300 |

改造逻辑：

```typescript
// 有 --role 时进入 subagent 模式（无 TUI，直接输出 JSON 行流）
if (role) {
  await runSubagentMode({ wikiRoot, role, query, systemPromptFile, timeout });
  return;
}
```

### 2. Subagent 运行模式（`src/subagent.ts`）

```typescript
export async function runSubagentMode(options: SubagentOptions) {
  const { wikiRoot, role, query, systemPromptFile, timeout } = options;

  // 1. 加载 role 对应的 system prompt
  const systemPrompt = systemPromptFile
    ? await readFile(systemPromptFile, "utf-8")
    : DEFAULT_PROMPTS[role];  // 内置默认 prompt

  // 2. 创建 session，传入自定义 system prompt
  const runtime = await createWikiSession({ wikiRoot, systemPrompt, role });

  // 3. 订阅事件，输出 JSON 行流到 stdout
  const unsubscribe = runtime.session.subscribe(event => {
    process.stdout.write(JSON.stringify(toJsonEvent(event)) + "\n");
  });

  // 4. 发送 query
  await runtime.session.prompt(query);

  // 5. 等待完成
  await runtime.dispose();
}
```

关键点：`createWikiSession` 需要支持传入自定义 system prompt 和 role。

### 3. Wiki 工具实现（`src/core/extensions/wiki-tools.ts`）

**关键决策**：wiki 工具必须作为自定义工具注册（`ExtensionFactory`），不能依赖 pi 内置工具（read/write/bash）。

原因：subagent 需要完全隔离的工具集，只能操作 wikiroot。pi 内置工具可以操作任意文件，不符合安全边界。

```typescript
// src/core/extensions/wiki-tools.ts

// wiki_read — 读取 wiki 或 raw 下的文件
const wikiReadTool: ToolDefinition = {
  name: "wiki_read",
  label: "Wiki Read",
  description: "读取 wiki/ 或 raw/ 目录下的文件内容",
  parameters: WikiReadParams,  // { path, offset?, limit?, mode?: "wiki"|"raw" }
  async execute(_id, params) {
    const { path, mode = "wiki" } = params;
    const baseDir = mode === "raw" ? join(wikiRoot, "raw") : join(wikiRoot, "wiki");
    const content = await readFile(join(baseDir, path), "utf-8");
    return { content, truncated: content.length > 10000 };
  },
};

// wiki_write — 创建或更新 wiki 条目
const wikiWriteTool: ToolDefinition = { ... };

// wiki_search — 全文检索
const wikiSearchTool: ToolDefinition = { ... };

// wiki_list — 列出目录结构
const wikiListTool: ToolDefinition = { ... };

// wiki_ingest — 将 raw 文件摄入为 wiki 条目
const wikiIngestTool: ToolDefinition = { ... };

// wiki_lint — 批量检查 wiki 问题
const wikiLintTool: ToolDefinition = { ... };

// 导出按角色分组的工具集
export const TOOLS_BY_ROLE = {
  ingest: [wikiReadTool, wikiWriteTool, wikiListTool, wikiIngestTool],
  query: [wikiReadTool, wikiSearchTool, wikiListTool, wikiLintTool],
  lint: [wikiReadTool, wikiWriteTool, wikiLintTool],
};
```

### 4. WikiAgent 改造（`src/core/agent.ts`）

```typescript
interface CreateSessionOptions {
  wikiRoot: string;
  systemPrompt?: string[];   // 新增：自定义 system prompt
  role?: "ingest" | "query" | "lint";  // 新增：角色标识
}

// createSession 根据 role 注册不同工具集
if (role) {
  // Subagent 模式：注册 wiki 自定义工具（不使用 pi 内置工具）
  const wikiTools = TOOLS_BY_ROLE[role];
  resourceLoaderOptions.extensionFactories = [
    wikiToolsExtension(wikiRoot, role),  // 传入 wikiRoot 和 role
  ];
}
```

**注意**：当前 `createWikiSession` 使用 `noSkills: true` 阻止外部 skills。subagent 模式下也需要保持这个设置，保证 subagent 只使用注册的自定义 wiki 工具。

### 5. 工具参数复用（`src/types.ts`）

现有 `types.ts` 中已定义工具参数类型：

```typescript
// 复用现有类型
export const WikiReadParams = Type.Object({ ... });
export const WikiWriteParams = Type.Object({ ... });
export const WikiSearchParams = Type.Object({ ... });
export const WikiListParams = Type.Object({ ... });
export const WikiIngestParams = Type.Object({ ... });
export const WikiLintParams = Type.Object({ ... });
```

`wiki-tools.ts` 直接导入这些类型，保持类型定义单一来源。

### 6. Subagent 分发工具（`src/core/extensions/dispatcher.ts`）

通过 `ExtensionFactory` 注册到主 agent：

```typescript
export const dispatcherExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: "wiki_dispatch",
    label: "Wiki Dispatcher",
    description: [
      "将任务分发给专门的 subagent 处理。",
      "ingest：摄入源文件到 wiki",
      "query：在 wiki 中检索并回答问题",
      "lint：检查并修复 wiki 问题",
    ].join(" "),
    parameters: Type.Object({
      role: Type.Union([
        Type.Literal("ingest"),
        Type.Literal("query"),
        Type.Literal("lint"),
      ], { description: "Subagent 角色" }),
      task: Type.String({ description: "要执行的任务描述" }),
    }),
    async execute(toolCallId, params, signal, onUpdate) {
      const result = await runWikiSubagent({
        role: params.role,
        task: params.task,
        wikiRoot: ctx.wikiRoot,
        signal,
        onUpdate: (event) => {
          // 实时推送 delta 事件
          onUpdate({ content: [{ type: "text", text: event.text }] });
        },
      });

      return {
        content: [{ type: "text", text: result.summary }],
        details: { role: params.role, ...result },
      };
    },
  });
};
```

注册到主 agent 的方式：

```typescript
// 在 WikiAgent.createSession() 的 resourceLoaderOptions 中传入
resourceLoaderOptions: {
  extensionFactories: [dispatcherExtension],  // 新增
  appendSystemPrompt: mainSystemPromptLines,
}
```

### 7. Subagent System Prompts

#### `src/templates/subagent-ingest-prompt.md`

```
你是一个 Wiki 知识摄入 Agent。

## 核心职责
将原始资料（raw/ 下的文件）转化为结构化 wiki 知识。

## 工具使用规则
- wiki_read：读取 raw/ 下的源文件
- wiki_write：创建 wiki/ 下的结构化文档
- wiki_list：查看当前 wiki 结构

## 工作流程
1. 读取源文件，理解内容
2. 识别关键实体、概念、关系
3. 按 frontmatter 格式写入 wiki/ 条目
4. 更新 index.md（新增条目）

## 严禁行为
- 不得修改不在 ingest 任务范围内的文件
- 不得凭空创造知识
- 不得在 wiki 中已有相关条目时重复创建
```

#### `src/templates/subagent-query-prompt.md`

```
你是一个 Wiki 知识检索 Agent。

## 核心职责
在 wiki 中检索知识，回答用户问题。

## 工具使用规则
- wiki_search：全文检索 wiki 内容
- wiki_read：读取具体条目
- wiki_list：了解 wiki 结构
- wiki_lint：检查引用完整性（可选）

## 回答要求
- 必须先检索 wiki，再作答
- 引用来源必须标注具体条目名
- wiki 中无相关信息时，明确告知

## 严禁行为
- 不得凭空编造知识
- 不得使用训练数据补充 wiki 缺失
- 不得修改任何 wiki 文件
```

#### `src/templates/subagent-lint-prompt.md`

```
你是一个 Wiki 质量检查 Agent。

## 核心职责
检查 wiki 结构完整性和内容质量。

## 工具使用规则
- wiki_read：读取条目内容
- wiki_write：修复发现的问题
- wiki_lint：批量检查问题

## 检查项
- orphan：被引用但不存在
- broken_link：链接失效
- stale_claim：过时声明
- missing_frontmatter：缺少元数据
- 结构完整性：index.md 与实际条目一致

## 工作流程
1. 运行 wiki_lint 快速扫描
2. 逐个分析问题
3. 自动修复（fix: true）或报告

## 严禁行为
- 不得修改不在问题范围内的文件
- 不得删除有价值的条目（只能清理 orphan 引用）
```

## 文件变更

```diff
 src/
+├── subagent.ts                          ← Subagent 进程运行逻辑（JSON 行流）
+├── core/
+│   ├── agent.ts                         ← WikiAgent.createSession() 支持 role/systemPrompt
+│   └── extensions/
+│       ├── wiki-tools.ts                ← 自定义 wiki 工具（wiki_read/write/search/list/ingest/lint）
+│       └── dispatcher.ts                ← ExtensionFactory：wiki_dispatch 工具
+├── templates/
+│   ├── subagent-ingest-prompt.md        ← Ingest subagent system prompt
+│   ├── subagent-query-prompt.md         ← Query subagent system prompt
+│   └── subagent-lint-prompt.md          ← Lint subagent system prompt
+└── types.ts                             ← 复用现有工具参数类型
 src/
  ├── cli.ts                              ← 支持 --role/--query/--system-prompt 参数
  └── core/
      └── runtime.ts                      ← createWikiSession 支持 systemPrompt/role 参数
```

## 实现顺序

| 步骤 | 内容 | 优先级 |
|------|------|--------|
| 1 | CLI 改造：支持 `--role/--query/--system-prompt` 参数 | P0 |
| 2 | WikiAgent.createSession() 支持 `systemPrompt` + `role` + `tools` 参数 | P0 |
| 3 | 创建 3 个 subagent system prompt 文件 | P0 |
| 4 | `runSubagentMode()` 实现（JSON 行流输出） | P0 |
| 5 | `wiki_dispatch` ExtensionFactory（分发工具） | P1 |
| 6 | 主 agent 注册 dispatcher extension | P1 |
| 7 | 测试：手动跑各 subagent 模式 | P2 |
| 8 | 端到端测试：主 agent 分发任务 | P2 |

## 测试策略

| 测试 | 方法 |
|------|------|
| CLI subagent 模式 | `llm-wiki-agent --wiki ~/wiki --role query --query "..."` 验证 JSON 行流 |
| WikiAgent role 参数 | 单元测试：不同 role 创建的 session 有不同工具集 |
| 分发工具 | E2E：主 agent 调用 wiki_dispatch，验证子进程输出被正确处理 |
| 超时/取消 | 验证 AbortSignal 能正确终止子进程 |

## 源码参考

| 模式 | 参考来源 |
|------|---------|
| ExtensionFactory | `~/data/github/pi-mono/packages/coding-agent/examples/extensions/subagent/index.ts` |
| Subagent 进程管理 | 同上，`spawn` + stdout JSON 行解析 |
| getPiInvocation | 同上，`getPiInvocation()` 检测运行时环境 |
| SessionManager | `~/data/github/pi-mono/packages/coding-agent/src/core/session-manager.ts` |
| openclaw 扩展机制 | `~/data/github/openclaw/src/agents/pi-embedded-runner/extensions.ts` |
