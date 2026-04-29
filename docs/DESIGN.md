# LLM Wiki Agent — 设计文档

## 1. 背景与目标

### 1.1 需求来源

`docs/llm-wiki.md`（v1）和 `docs/llm-wiki-v2.md`（v2）分别描述了 LLM Wiki Pattern 的基础版和增强版。本项目基于 `pi-ai` + `pi-agent-core` 实现一个专用 Agent CLI，支持 v1 和 v2 定义的操作集合。

### 1.2 Wiki 知识库

- 每个 Wiki 是一个独立目录，拥有自己的 `AGENTS.md` schema workflow
- 通过 `--wiki <path>` 指定 Wiki 根目录，**每次只能指定一个**
- 全局配置 `~/.llm-wiki-agent/config.jsonl` 记录模型选择
- Agent 的 **workdir 设置为 wikiroot**，这样 pi 的 skills/AGENTS.md 查找机制才能自动读取该目录下的文件

### 1.3 参考架构

参考 `pi-coding-agent` 的设计模式，以模块化方式复用 pi-mono 生态：

| 层级 | 依赖 | 作用 |
|------|------|------|
| LLM 运行时 | `pi-ai` | 多 Provider 支持（OpenAI/Anthropic/Google…） |
| Agent 核心 | `pi-agent-core` | `Agent` 类、`agentLoop`、工具执行 |
| Agent CLI | 自行组装 | Wiki 专用工具 + CLI 入口 |

> 不直接依赖 `pi-coding-agent`（它是"编程助手"定位，内置了 file/bash/edit 等不适合 Wiki 场景的工具）。基于底层 core 重构更干净。

### 1.4 Scope 边界

**做：** TUI 聊天界面、Wiki 操作工具、Agent Runtime 组装、AGENTS.md 驱动的 Schema Workflow、自动初始化。

**不做：** Web UI、Extension 系统（从简）、Compaction。

---

## 2. 架构概览

```
llm-wiki-agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts              # CLI 入口（--wiki 参数）
│   ├── config.ts           # ~/.llm-wiki-agent/config.jsonl 读写
│   ├── runtime.ts          # Agent Runtime 组装
│   ├── init.ts             # Wiki 目录初始化
│   ├── tui.ts              # TUI 聊天界面
│   ├── agents.ts          # 读取 AGENTS.md 注入 system prompt
│   ├── tools/
│   │   ├── index.ts
│   │   ├── wiki-read.ts
│   │   ├── wiki-write.ts
│   │   ├── wiki-search.ts
│   │   ├── wiki-list.ts
│   │   ├── wiki-ingest.ts
│   │   └── wiki-lint.ts
│   └── types.ts
```

**工作模式：**

- **TUI**：终端聊天界面（主要交互方式）
- **开箱即用**：`--wiki <path>` 指定目录，不存在则自动初始化

---

### 2.1 Wiki 目录结构

每个 Wiki 根目录下必须包含：

```
wiki-root/
├── AGENTS.md               # ★ 必须：Schema Workflow
├── .wikiconfig.yaml        # Wiki 本地配置（版本、名称等）
├── .wiki/                  # Agent 内部元数据
│   ├── log.md              # 操作日志（append-only）
│   └── sessions/           # 对话 Session（JSONL）
├── raw/                    # 原始资料（v1/v2 通用）
│   ├── sources/            # 文章、PDF、网页 clip
│   └── assets/             # 附件、图片
└── wiki/                   # LLM 生成的 wiki 页面（v1/v2 通用）
    ├── index.md            # 页面目录（v1 主要导航）
    ├── entities/           # 实体页面
    ├── concepts/           # 概念页面
    ├── sources/            # 来源摘要页
    └── synthesis/          # 综合/分析页
```

> Agent 启动时读取 `<wikiroot>/AGENTS.md` 内容，注入 system prompt。

---

## 3. 配置系统

**Wiki**：用户指定的工作目录，包含 `AGENTS.md`、内容页、raw 资料

**Agent**：`~/.llm-wiki-agent/config.jsonl` 存放 Agent 自身的配置（providers、模型选择等）

### 3.1 Agent 全局配置

路径：`~/.llm-wiki-agent/config.jsonl`

格式参考 `~/.pi/agent/models.json`：

```jsonl
{"providers":{"anthropic":{"apiKey":"sk-..."}},"defaultModel":"anthropic/claude-sonnet-4"}
{"providers":{"openai":{"apiKey":"sk-..."}},"defaultModel":"openai/gpt-4o"}
{"providers":{"google":{"apiKey":"..."},"omlx":{"baseUrl":"http://localhost:8000/v1","apiKey":"123456"}},"defaultModel":"google/gemini-2.5-pro"}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `providers` | `Record<string, ProviderConfig>` | Provider 配置，key 为 provider 名称 |
| `defaultModel` | `string` | 默认模型（格式：`provider/model-id`） |

> **Provider 配置格式**与 `~/.pi/agent/models.json` 一致，支持 `baseUrl`、`api`、`apiKey` 等字段。

### 3.2 Wiki 本地配置

路径：`<wiki-root>/.wikiconfig.yaml`

```yaml
name: "我的研究 Wiki"
version: "v2"
schema_version: "1.0"
description: "个人研究笔记，知识累积"
created: 2026-04-29
```

---

## 4. Wiki 数据模型

### 4.1 页面 Frontmatter

```yaml
---
title: React 状态管理
type: entity
tags: [frontend, architecture]
confidence: 0.85           # v2：置信度
created: 2026-04-01
updated: 2026-04-10
sources: [1, 3]           # 引用的 source 页编号
supersedes: null           # v2：替代了哪个旧页面
---
```

### 4.2 版本差异摘要

| 维度 | v1 | v2 |
|------|----|----|
| 导航 | index.md 文件 | 知识图 + index.md |
| 搜索 | index.md 全文扫描 | 混合搜索（BM25 + vector + graph） |
| 置信度 | 无 | 每条事实带 confidence |
| 层级 | 3 层（raw/wiki/schema） | 4 consolidation tiers |
| 实体关系 | wikilink | typed graph edges |
| 自动化 | 手动触发 | event-driven hooks |

---

## 5. 工具设计

### 5.1 工具总览

| 工具名 | 阶段 | v1 支持 | v2 支持 | 说明 |
|--------|------|---------|---------|------|
| `wiki_read` | Query | ✅ | ✅ | 读取 wiki 页面 |
| `wiki_write` | Ingest/Query | ✅ | ✅ | 创建/更新页面 |
| `wiki_search` | Query | ✅ | ✅ | 搜索 wiki 内容 |
| `wiki_list` | Query | ✅（index.md） | ✅（index.md + graph） | 列出 wiki 结构 |
| `wiki_ingest` | Ingest | ✅ | ✅ | 消化新 source |
| `wiki_lint` | Lint | ✅ | ✅ | 健康检查 |

### 5.2 wiki_read

**用途：** 读取一个 wiki 页面或 raw source。

**参数：**
```typescript
{
  path: string;        // 页面路径（相对于 wiki/ 或 raw/）
  offset?: number;     // 行号（1-indexed）
  limit?: number;      // 最大行数
  mode?: "wiki" | "raw";  // 读取 wiki 还是 raw
}
```

**实现要点：**
- 复用 `pi-coding-agent` 的 `read.ts` 工具模式：`ToolDefinition` + `execute` + `renderCall/renderResult`
- 路径解析：`wikiDir` 或 `rawDir` + `path`
- 支持 frontmatter 解析，返回结构化元数据

**数据流：**
```
LLM 调用 wiki_read(path="entities/react.md")
→ 解析路径 → fs.readFile
→ 解析 frontmatter → 截断长文件
→ 返回 { content: TextContent[], details: { frontmatter, truncation } }
```

### 5.3 wiki_write

**用途：** 创建新页面或更新已有页面。

**参数：**
```typescript
{
  path: string;           // 页面路径
  content: string;        // markdown 内容
  frontmatter?: object;  // YAML frontmatter
  mode?: "create" | "update";
}
```

**实现要点：**
- 写之前先 `fs.readFile` 检查是否存在（create vs update）
- 自动追加 `updated` 时间戳到 frontmatter
- v2 场景下，写入后自动更新 `index.md`

### 5.4 wiki_search

**用途：** 搜索 wiki 页面内容。

**参数：**
```typescript
{
  query: string;           // 搜索词
  scope?: "wiki" | "raw" | "all";
  limit?: number;         // 返回结果上限（默认 10）
}
```

**v1 实现：** grep 扫描所有 `.md` 文件，关键词匹配 + 上下文片段。

**v2 增强：** 预留接口，实际实现保持与 v1 相同。v2 的 hybrid search 超出 MVP 范围。

### 5.5 wiki_list

**用途：** 列出 wiki 目录结构或 index 内容。

**参数：**
```typescript
{
  path?: string;           // 目录路径（默认 wiki/）
  format?: "tree" | "index";  // tree 视图或 index.md 内容
  include_raw?: boolean;   // 是否包含 raw/ 目录
}
```

### 5.6 wiki_ingest

**用途：** 消化一个 raw source，生成/更新 wiki 页面。

**参数：**
```typescript
{
  source_path: string;     // raw/ 下的文件路径
  options?: {
    force?: boolean;       // 强制重新 ingest
    tier?: "working" | "episodic" | "semantic";  // v2: consolidation tier
  }
}
```

**v1 流程（LLM 自行决定）：**
1. 读取 source
2. 讨论要点
3. 写 summary 页面到 `wiki/sources/`
4. 更新 `index.md`
5. 更新相关 entity/concept 页面
6. 追加 `log.md`

**v2 扩展（通过 options.tier）：**
- 写 summary 时添加 confidence 字段
- 自动提取 entity + typed relationships（写入 frontmatter/graph）

### 5.7 wiki_lint

**用途：** 健康检查，发现问题。

**参数：**
```typescript
{
  mode?: "quick" | "full";
  fix?: boolean;           // 是否自动修复
}
```

**v1 检查项：** orphan pages、broken wikilinks、stale claims。
**v2 检查项：** 包含 v1 + confidence decay、contradiction detection、retention check。

> `fix=true` 时，工具执行修复操作（调用 wiki_write 更新页面）。fix 后的结果以 structured 方式返回给 LLM，让 LLM 决定是否采纳。

---

## 6. Agent Runtime 组装

### 6.1 基于 pi-agent-core 的 Agent

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { loadConfig } from "./config.js";
import { loadAgentsMd } from "./agents.js";
import { createWikiTools } from "./tools/index.js";

const config = await loadConfig();  // 从 ~/.llm-wiki-agent/config.jsonl 读取
const version = loadWikiConfig(wikiRoot);  // 从 .wikiconfig.yaml 读取版本
const systemPrompt = await loadAgentsMd(wikiRoot);  // 读取 AGENTS.md

const agent = new Agent({
  initialState: {
    systemPrompt,
    tools: createWikiTools({ wikiRoot, version }),
  },
  convertToLlm: defaultConvertToLlm,
  toolExecution: "sequential",
});
```

### 6.2 AGENTS.md 加载

```typescript
// src/agents.ts
import { readFile } from "fs/promises";
import { DEFAULT_AGENTS_MD } from "./default-agents.js";

export async function loadAgentsMd(wikiRoot: string): Promise<string> {
  const path = join(wikiRoot, "AGENTS.md");
  try {
    return await readFile(path, "utf-8");
  } catch {
    return DEFAULT_AGENTS_MD;  // 不存在时使用内置默认模板
  }
}
```

- Wiki 目录存在 `AGENTS.md` → 读取使用
- 不存在 → 使用内置默认模板（v1）

### 6.3 工具注册模式

```typescript
// src/tools/index.ts
import { defineTool } from "@mariozechner/pi-agent-core";
import { createWikiReadTool } from "./wiki-read.js";
import { createWikiWriteTool } from "./wiki-write.js";
// ...

export type WikiToolName = "wiki_read" | "wiki_write" | "wiki_search" | "wiki_list" | "wiki_ingest" | "wiki_lint";

export function createWikiTools(opts: { wikiRoot: string; version: "v1" | "v2" }) {
  return [
    createWikiReadTool(opts.wikiRoot),
    createWikiWriteTool(opts.wikiRoot, opts.version),
    createWikiSearchTool(opts.wikiRoot),
    createWikiListTool(opts.wikiRoot),
    createWikiIngestTool(opts.wikiRoot, opts.version),
    createWikiLintTool(opts.wikiRoot, opts.version),
  ];
}
```

> 工具定义模式直接参考 `pi-coding-agent/src/core/tools/read.ts`：TypeBox Schema + `execute()` 函数 + `renderCall/renderResult` 渲染钩子。

---

## 7. CLI 设计

### 7.1 设计原则

开箱即用：运行 `llm-wiki-agent --wiki <path>` 时，若目录不存在则自动初始化。

### 7.2 命令行接口

```bash
llm-wiki-agent --wiki <path> "问题"       # 单次查询
llm-wiki-agent --wiki <path>               # 交互模式（TUI）
```

- 指定 Wiki 路径即可开始，自动初始化目录结构
- **Agent workdir = wikiroot**：工具中的相对路径、skills 加载、AGENTS.md 查找均基于此目录
- 携带问题则单次查询后退出，否则进入 TUI 交互模式
- Ingest 和 Lint 是 Agent 工具调用，由 LLM 自行决定何时使用

---

## 8. Session 管理（轻量）

### 8.1 设计原则

pi-coding-agent 的 Session Manager 过于复杂（compaction、branching、tree 等）。本项目用简化的 JSONL Session：

```
.wiki/sessions/
└── <session-id>.jsonl    # 每行一个 AgentMessage（JSON）
```

### 8.2 Session 内容

```json
{"role":"user","content":[{"type":"text","text":"..."}],"timestamp":1745836800000}
{"role":"assistant","content":[{"type":"text","text":"..."}],"timestamp":1745836810000}
{"role":"toolResult","content":[{"type":"text","text":"..."}],"toolName":"wiki_read","timestamp":1745836820000}
```

### 8.3 Session 操作

- **创建**：`SessionManager.create(wikiRoot)` → 生成 session-id
- **继续**：`SessionManager.continue(session-id)` → 读取 JSONL，恢复 agent state
- **列表**：`SessionManager.list(wikiRoot)` → 列出所有 session
- **压缩**：当 session 超过 N 条消息时，调用 LLM 生成摘要，用摘要替换原始消息（简易 compaction）

---

## 9. 实现计划

### Phase 1：骨架 + TUI + 基础工具

- [ ] 项目结构搭建（package.json、tsconfig）
- [ ] `src/config.ts`：Agent 配置读写（`~/.llm-wiki-agent/config.jsonl`）
- [ ] `src/cli.ts`：参数解析（`--wiki`）
- [ ] `src/init.ts`：Wiki 目录初始化
- [ ] `src/tui.ts`：TUI 聊天界面（基于 `pi-tui`）
- [ ] `src/agents.ts`：读取 AGENTS.md 注入 system prompt
- [ ] `src/runtime.ts`：Agent Runtime 组装
- [ ] `src/tools/wiki-read.ts`
- [ ] `src/tools/wiki-write.ts`
- [ ] `src/tools/wiki-search.ts`
- [ ] `src/tools/wiki-list.ts`
- [ ] `src/default-agents.md`：内置默认 AGENTS.md 模板

### Phase 2：Ingest + Lint + Session

- [ ] `src/tools/wiki-ingest.ts`
- [ ] `src/tools/wiki-lint.ts`
- [ ] `src/session.ts`：Session 管理（`WikiRoot/.wiki/sessions/*.jsonl`）

### Phase 3：打磨

- [ ] v2 增强（confidence、entity extraction frontmatter）
- [ ] 单元测试

---

## 10. 技术约束与决策

| 决策 | 理由 |
|------|------|
| 每次只指定一个 wiki | 简化，专注单一知识库 |
| 不用 pi-coding-agent，用底层 core | file/bash/edit 工具与 Wiki 场景无关，引入无谓依赖 |
| Session 用 JSONL 而非 pi 的复杂 tree | Wiki Agent 不需要 branching/compaction，简化优先 |
| 不做 Extension 系统 | MVP 阶段工具集合固定，不需要动态注册 |
| 不做 v2 的 hybrid search | 超出 MVP，v1 的 grep 扫描够用 |
| 工具执行模式为 sequential | wiki 操作往往有因果顺序（ingest 后才能 read），sequential 更安全 |
| v2 增强通过 frontmatter 实现 | 不引入额外存储，pages 即 structured data |

---

## 11. 源码参考索引

| 参考点 | 源码位置 | 关键内容 |
|--------|----------|----------|
| Agent 核心 | `pi-agent-core/src/agent.ts` | `Agent` class、state、prompt/continue |
| Agent Loop | `pi-agent-core/src/agent-loop.ts` | `runLoop`、`executeToolCalls` |
| 工具定义模式 | `pi-coding-agent/src/core/tools/read.ts` | `ToolDefinition`、`execute`、`renderCall/renderResult` |
| 工具工厂 | `pi-coding-agent/src/core/tools/index.ts` | `createTool`、`createReadTool` |
| pi-ai 模型 | `pi-ai/src/providers/` | 多 provider 注册机制 |
| Extension 类型 | `pi-coding-agent/src/core/extensions/types.ts` | `ToolDefinition<TParams>`、`defineTool` |
