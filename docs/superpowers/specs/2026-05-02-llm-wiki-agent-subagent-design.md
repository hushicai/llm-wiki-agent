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
│  工具集：仅 subagent 工具（pi 内置 subagent extension）     │
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
   pi built-in   pi built-in  pi built-in
   (read/write/  (read/grep/  (read/write/
    bash/grep)    find/ls)     bash/grep)
   SysPrompt:   SysPrompt:   SysPrompt:
   wiki-ingest  wiki-query   wiki-lint
     agents       agents      agents
```

| 约束 | 说明 |
|------|------|
| **完全隔离的上下文窗口** | 每个 subagent 是独立子进程，拥有独立内存上下文 |
| **Subagent 纯净模式** | `noExtensions: true` + `noSkills: true`，只有内置工具 + system prompt |
| **内置工具读写 wikiroot** | Subagent 使用 pi 内置工具 + 自定义 system prompt |

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

**CLI 新增参数**（`src/cli.ts`）：

```bash
llm-wiki-agent --wiki <path> --mode <interactive|json> --role <name> --append-system-prompt <file>
```

| 参数 | 说明 |
|------|------|
| `--mode json` | 使用 `runPrintMode({ mode: "json" })` 输出 JSON 事件流（用于 subagent 子进程） |
| `--role <name>` | Subagent 角色名（如 `wiki-ingest`） |
| `--append-system-prompt <file>` | 从文件加载 system prompt |

**实现方式**：复用 pi SDK 的 `runPrintMode(runtime, { mode: "json", initialMessage: task })`。只需：
1. 解析 `--mode json` 参数
2. 有 `--mode json` 时调用 `runPrintMode` 而非 InteractiveMode
3. Task 从 `positionalArgs` 或 stdin 获取

Subagent 进程通过 `--mode json` 输出 JSON 行流到 stdout，主 agent 的 wiki-subagent extension 实时解析。

### 3. Subagent Extension（使用 pi SDK 内置）

**关键决策**：使用 pi SDK 的 subagent extension，不自己实现分发工具。

- 主 agent 注册 pi 的 `subagent` 扩展（内置一个 `subagent` 工具）
- Subagent 从 `~/.llm-wiki-agent/agents/` 目录发现
- Subagent 启动时带上自定义 system prompt 和工具集

#### Subagent 定义文件（`~/.llm-wiki-agent/agents/*.md`）

每个 subagent 是一个 `.md` 文件：

```markdown
---
name: wiki-ingest
description: 将原始资料摄入 wiki。触发词：ingest、录入、add to wiki。
tools: read,bash,grep,find
---
# Wiki Ingest Agent

你是一个专门将原始资料转化为结构化 wiki 知识的 Agent...

（body 作为 system prompt）
```

| 文件 | Role | Tools | 说明 |
|------|------|-------|------|
| `wiki-ingest.md` | ingest | read,bash | 将 raw 文件摄入 wiki |
| `wiki-query.md` | query | read,grep,find | 检索 wiki 回答问题 |
| `wiki-lint.md` | lint | read,write,bash,grep | 检查并修复 wiki 问题 |

#### WikiAgent 改造

```typescript
// 主 agent 模式：注册 pi 的 subagent extension
if (role === undefined) {
  resourceLoaderOptions.extensionFactories = [wikiSubagentExtension];
} else {
  // Subagent 自身模式：禁用所有扩展和 skills，只有内置工具 + 自定义 system prompt
  resourceLoaderOptions.noExtensions = true;
  resourceLoaderOptions.noSkills = true;
  resourceLoaderOptions.systemPrompt = loadSubagentPrompt(role);
}
```

**关键约束**：subagent 必须 `noExtensions: true`，否则会看到主 agent 注册的 `subagent` 工具，形成循环。

### 7. Subagent Agent 定义文件

Subagent 的 system prompt 写在 agent 定义文件中（`.md` 格式），放在 `~/.llm-wiki-agent/agents/`。

**注意**：pi subagent extension 默认从 `~/.pi/agent/agents/` 发现 agent。需要修改 `discoverAgents()` 的查找路径为 `~/.llm-wiki-agent/agents/`。

#### `~/.llm-wiki-agent/agents/wiki-ingest.md`

```markdown
---
name: wiki-ingest
description: 将原始资料摄入 wiki。触发词：ingest、录入、add to wiki。
tools: read,bash,grep,find
---
你是一个 Wiki 知识摄入 Agent。

## 核心职责
将原始资料（raw/ 下的文件）转化为结构化 wiki 知识。

## 工作目录
{wikiRoot}

## 工作流程
1. 读取 raw/ 下的源文件，理解内容
2. 识别关键实体、概念、关系
3. 按 frontmatter 格式写入 wiki/ 条目
4. 更新 index.md（新增条目）

## 严禁行为
- 不得修改不在 ingest 任务范围内的文件
- 不得凭空创造知识
- 不得在 wiki 中已有相关条目时重复创建
```

#### `~/.llm-wiki-agent/agents/wiki-query.md`

```markdown
---
name: wiki-query
description: 在 wiki 中检索并回答问题。触发词：search wiki、find、tell me about。
tools: read,grep,find
---
你是一个 Wiki 知识检索 Agent。

## 核心职责
在 wiki 中检索知识，回答用户问题。

## 工作目录
{wikiRoot}

## 回答要求
- 必须先检索 wiki，再作答
- 引用来源必须标注具体条目名
- wiki 中无相关信息时，明确告知

## 严禁行为
- 不得凭空编造知识
- 不得修改任何 wiki 文件
```

#### `~/.llm-wiki-agent/agents/wiki-lint.md`

```markdown
---
name: wiki-lint
description: 检查并修复 wiki 问题。触发词：lint、health check、检查、clean up wiki。
tools: read,write,bash,grep
---
你是一个 Wiki 质量检查 Agent。

## 核心职责
检查 wiki 结构完整性和内容质量。

## 工作目录
{wikiRoot}

## 检查项
- orphan：被引用但不存在
- broken_link：链接失效
- index 不一致：index.md 与实际文件不符
- 缺少 frontmatter

## 工作流程
1. 扫描 wiki/ 目录结构
2. 逐个检查问题
3. 自动修复（fix: true）或报告

## 严禁行为
- 不得修改不在问题范围内的文件
```

**注意**：`{wikiRoot}` 占位符由 subagent extension 在启动子进程时替换为实际路径。

## 文件变更

```diff
 src/
+├── cli.ts                              ← 支持 --role/--system-prompt 参数
+├── core/
+│   ├── agent.ts                        ← WikiAgent.createSession() 支持 role
+│   └── extensions/
+│       └── wiki-subagent.ts            ← Subagent extension（spawn llm-wiki-agent 子进程）
 ~/.llm-wiki-agent/
+├── agents/                             ← Subagent 定义文件
+│   ├── wiki-ingest.md                 ← Ingest subagent
+│   ├── wiki-query.md                  ← Query subagent
+│   └── wiki-lint.md                  ← Lint subagent
```

**说明**：
- `wiki-subagent.ts` 是基于 pi SDK subagent extension 改编的扩展，注册一个 `subagent` 工具
- 子进程命令改为 `llm-wiki-agent --mode json --wiki <path> --append-system-prompt <file> <task>`
- 发现路径改为 `~/.llm-wiki-agent/agents/`，而非默认的 `~/.pi/agent/agents/`
- **关键**：subagent CLI 以 `noExtensions: true` + `noSkills: true` 启动，避免看到 `subagent` 工具

## 实现顺序

| 步骤 | 内容 | 优先级 |
|------|------|--------|
| 1 | 创建 `~/.llm-wiki-agent/agents/` 下的 3 个 subagent 定义文件 | P0 |
| 2 | CLI 改造：支持 `--role/--system-prompt-file` 参数 | P0 |
| 3 | WikiAgent.createSession() 支持 `role` + `systemPrompt` | P0 |
| 4 | `wiki-subagent.ts`：基于 pi subagent extension 改编的扩展 | P0 |
| 5 | 主 agent 注册 wiki-subagent extension | P1 |
| 6 | 测试：手动跑各 subagent 模式（`llm-wiki-agent --role ingest ...`） | P2 |
| 7 | 端到端测试：主 agent 调用 subagent 工具分发任务 | P2 |

## 测试策略

| 测试 | 方法 |
|------|------|
| CLI subagent 模式 | `llm-wiki-agent --role query --system-prompt-file <file>` 验证正常工作 |
| Subagent extension | E2E：主 agent 调用 `subagent({ agent: "wiki-ingest", task: "..." })`，验证子进程输出被正确处理 |
| 超时/取消 | 验证 AbortSignal 能正确终止子进程 |

## 源码参考

| 模式 | 参考来源 |
|------|---------|
| Subagent extension | `~/data/github/pi-mono/packages/coding-agent/examples/extensions/subagent/index.ts` |
| Agent 发现 | `~/data/github/pi-mono/packages/coding-agent/examples/extensions/subagent/agents.ts` |
| spawn + JSON 行解析 | 同上，`runSingleAgent()` 中 `spawn` + stdout 解析 |
| ExtensionFactory | `~/data/github/pi-mono/packages/coding-agent/docs/extensions.md` |
