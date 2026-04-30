# llm-wiki-agent Design

基于 pi-coding-agent SDK 二次开发，聚焦 wiki 操作的个人知识库 Agent。v1 实现基础操作（ingest/query/lint），v2 规划更复杂的能力（记忆生命周期、知识图谱、混合搜索、自动化事件驱动等）。

---

## 1. 背景与目标

### 1.1 需求来源

实现 [Andrej Karpathy 的 LLM Wiki 理念](https://gist.github.com/karpathy/442a6bf555914893e9891c19de94f)——一个由 LLM 维护的、持续积累的个人知识库。v1 和 v2 分别定义了基础版和增强版的操作集合。

### 1.2 技术选型

选择自研 Agent（pi-coding-agent）而不是通用 Agent + Skills 的核心原因：

| # | 因素 | 类型 | 说明 |
|---|------|------|------|
| 1 | **工具面隔离** | 否决项 | wiki Agent 不需要 bash，通用 Agent 关不掉 |
| 2 | **Session 隔离** | 架构需求 | 每个 wiki 独立会话历史，支持持续积累 |
| 3 | **代码级扩展** | 架构需求 | v2 的图/搜索/记忆需要算法实现，prompt 不够用 |
| 4 | **依赖匹配** | 成本考量 | pi-coding-agent 提供 agent 基础设施，不提供不需要的 RAG/编排 |
| 5 | **自撸成本** | 成本考量 | 自撸 agent loop 需 2000-3000 行，且不如 pi-coding-agent 成熟 |

详见 `./2026-04-29-llm-wiki-agent-tech-stack.md`（已归档至此文档）。

---

## 2. Architecture

```
llm-wiki-agent/
├── src/
│   ├── cli.ts             # CLI 入口
│   ├── config.ts          # 配置管理 (~/.llm-wiki-agent/)
│   ├── runtime.ts         # createWikiSession() — 包装 createAgentSessionRuntime()
│   ├── init.ts            # wiki 初始化（自愈）
│   ├── frontmatter.ts     # Frontmatter 解析/格式化/合并
│   ├── types.ts           # TypeBox schemas + 类型定义
│   ├── tools/
│   │   ├── index.ts       # createWikiTools()
│   │   ├── wiki-read.ts
│   │   ├── wiki-write.ts  # 自动 bookkeeping
│   │   ├── wiki-search.ts
│   │   ├── wiki-list.ts
│   │   ├── wiki-ingest.ts
│   │   └── wiki-lint.ts   # orphan page + broken wikilink 检测
│   └── init.ts
├── references/            # v1, v2 参考文档
└── tests/
```

### 2.1 Dependency

```json
{
  "@mariozechner/pi-coding-agent": "^0.70.5",
  "@mariozechner/pi-ai": "^0.70.5",
  "typebox": "^1.1.24",
  "yaml": "^2.5.0"
}
```

不直接依赖 `pi-agent-core`，通过 pi-coding-agent 间接使用。

### 2.2 Core: createWikiSession()

包装 `createAgentSessionRuntime()` + `createAgentSession()`，固定配置：

- 6 个 wiki 工具注册，禁用所有内置编程工具（`noTools: "all"`）
- `noSkills: true` 阻断外部技能
- `~/.llm-wiki-agent/skills/` 白名单路径
- 异步 context window 探测（`/v1/models` 端点）
- 按 wiki slug 隔离 session 目录

```typescript
const runtime = await createWikiSession({ wikiRoot });
const session = runtime.session;       // AgentSession
const services = runtime.services;     // AgentSessionServices
await runtime.dispose();               // 清理
```

### 2.3 Wiki 目录结构

```
<wiki-root>/
├── .wikiconfig.yaml        # Wiki 配置（名称、版本等）
├── AGENTS.md               # LLM 操作指南（ingest/query/lint 工作流）
├── index.md                # 页面索引（工具自动维护）
├── log.md                  # 操作日志（工具自动维护）
├── raw/                    # 原始资料（只读，用户放置文件）
├── entities/               # 实体页面（人物、项目、工具）
├── concepts/               # 概念页面（想法、模式、主题）
└── pages/                  # 通用页面（其他一切）
```

---

## 3. Configuration

独立配置目录 `~/.llm-wiki-agent/`，与 `~/.pi/agent/` 完全隔离：

```
~/.llm-wiki-agent/
├── auth.json         (API key)
├── models.json       (provider 配置)
├── settings.json     (默认模型、thinking level)
└── sessions/
    ├── <wiki-slug>/  (按 wiki 隔离的会话历史)
    └── <wiki-slug>/
```

`models.json` 格式复用 pi 的 schema：

```json
{
  "providers": {
    "gf": {
      "baseUrl": "http://llm.example.com/api/oai/v1",
      "api": "openai-completions",
      "apiKey": "sk-xxx",
      "models": [{ "id": "deepseek-v4", "input": ["text"] }]
    }
  }
}
```

`settings.json`：

```json
{
  "defaultProvider": "gf",
  "defaultModel": "deepseek-v4",
  "defaultThinkingLevel": "medium"
}
```

---

## 4. CLI Interface

```
llm-wiki-agent --wiki <path>           交互模式（自动初始化）
echo "query" | llm-wiki-agent --wiki <path>   管道查询
llm-wiki-agent --version               版本号
llm-wiki-agent --help                  帮助
```

**工作模式：**
- **TUI**：基于 pi-coding-agent 的 `InteractiveMode`，终端聊天界面
- **PrintMode**：stdin 管道输入，单次查询后退出
- **自动初始化**：`--wiki` 指定目录不存在时自动创建目录结构

---

## 5. Tools (6个)

所有工具实现为 pi-coding-agent 的 `ToolDefinition`。

| Tool | Input | Output | Description |
|------|-------|--------|-------------|
| `wiki_read` | path, offset?, limit?, mode? | 页面内容 | 读取 wiki 页面或 raw 源文件，支持分页 |
| `wiki_write` | path, content, mode? | 写入结果 | 创建/更新页面。自动管理 frontmatter（时间戳）、index.md（新页面追加条目）、log.md（操作记录） |
| `wiki_search` | query, scope?, limit? | 匹配列表 + 摘要 | 按关键词搜索 wiki/raw 内容 |
| `wiki_list` | path?, format? | 目录树 | 列出 wiki 目录结构 |
| `wiki_ingest` | source_path | 源内容 | 读取 raw/ 下源文件，返回给 LLM 处理 |
| `wiki_lint` | mode? | 检查报告 | 健康检查：missing index.md、empty directories、orphan pages、broken wikilinks |

### 5.1 wiki_read

读取一个 wiki 页面或 raw source。支持分页（offset/limit）和 mode 切换（wiki/raw）。

**实现要点：**
- 路径解析：`wikiDir` 或 `rawDir` + `path`
- 支持分页：`Math.max(0, (offset || 1) - 1)` 到 `Math.min(lines.length, start + (limit || 500))`
- 文件不存在时返回错误

### 5.2 wiki_write

创建新页面或更新已有页面。**自动维护 frontmatter、index.md 和 log.md。**

**自动行为：**
1. **Frontmatter 管理** — 解析 content 中的 YAML frontmatter：
   - 新页面（create）：自动添加 `created` 时间戳
   - 已有页面（update）：自动更新 `updated` 时间戳，保留 `created`
   - 保留 LLM 提供的所有其他 frontmatter 字段（title、type、tags 等）
2. **Index.md 维护** — 新页面创建时，自动在 index.md 追加 `- [[Page Title]]` 条目（从 frontmatter.title 或文件名推断）
3. **Log.md 维护** — 每次写入操作，自动追加 `YYYY-MM-DDTHH:MM:SS: Created/Updated path`

**实现要点：**
- 使用 `yaml` 库解析/序列化 frontmatter
- 写入前检查文件是否存在判断 create vs update
- `mode: "create"` 时文件已存在则返回错误

### 5.3 wiki_search

搜索 wiki 页面内容。v1 用 grep 扫描所有 `.md` 文件，关键词匹配 + 上下文片段。

**参数：** query（必填）、scope（wiki/raw/all）、limit（默认 10）

**v2 增强：** 预留接口，v2 可换混合搜索（BM25 + vector）。

### 5.4 wiki_list

列出 wiki 目录结构。

**参数：** path（默认 wiki/）、format（tree/flat）

### 5.5 wiki_ingest

读取 raw/ 下的源文件，返回内容给 LLM 处理。LLM 自行决定如何创建/更新 wiki 页面。

**v1 流程（LLM 自行决定）：**
1. 读取 source
2. 提取实体/概念
3. 创建/更新 wiki 页面（工具自动管理 index.md 和 log.md）
4. 可选的 review

### 5.6 wiki_lint

健康检查，发现问题。

**v1 检查项：**
- Missing index.md
- Empty directories
- **Orphan pages**（wiki/ 中存在但 index.md 中未引用的页面）
- **Broken wikilinks**（`[[Page Name]]` 指向不存在的页面，支持 frontmatter.title 和文件名匹配）

**v2 检查项：** 包含 v1 + confidence decay、contradiction detection、retention check。

---

## 6. Data Flow

```
用户输入
  → AgentSession.prompt()
    → Agent 循环 → LLM 推理 → 工具调用
      → WikiTool.execute()
        → 文件系统操作（含自动 bookkeeping）
      → 结果返回 LLM
    → LLM 生成回复 (streaming)
  → 输出到终端
```

---

## 7. Session Management

- 按 wiki 隔离：`sessions/<wiki-slug>/`
- 复用 pi-coding-agent 的 SessionManager（compaction、恢复、模型切换历史）
- 启动时自动恢复未完成会话

---

## 8. Extensions 支持

当前 `createWikiSession()` 通过 `createAgentSessionServices()` 创建运行时服务，未设置 `noExtensions: true`，因此 pi-coding-agent 的 Extension 系统默认启用。

| 维度 | 状态 | 说明 |
|------|------|------|
| Extension 自动发现 | ✅ 启用 | `DefaultResourceLoader` 自动加载 `~/.llm-wiki-agent/extensions/` |
| Extension Factory | ✅ 支持 | 可通过 `resourceLoaderOptions.extensionFactories` 注入 |
| 工具注册 | ✅ 支持 | Extension 可注册自定义工具 |
| 错误处理 | ✅ 支持 | Extension 加载错误被捕获到 diagnostics |
| 配置暴露 | ❌ 未暴露 | `WikiSessionOptions` 未提供 `extensionFactories` 或 `noExtensions` 参数 |

---

## 9. v2 设计

### 9.1 v2 Extension Points

| v2 功能 | 扩展方式 | 复杂度 |
|---------|---------|--------|
| 置信度/遗忘 | `wiki_write` frontmatter 扩展字段 + 定时衰减计算 | 中 |
| 知识图谱 | 新增 `wiki_graph` 工具 + 图存储 | 高 |
| 混合搜索 | `wiki_search` 内部实现替换（BM25 + vector） | 中 |
| 自动化 hooks | pi Extension 系统 | 低 |
| 多 Agent 协作 | 新增协作层 + 共享存储 + 冲突检测 | 高 |

v1 工具接口保持稳定，v2 只改内部实现。

### 9.2 v2 版本差异

| 维度 | v1 | v2 |
|------|----|----|
| 导航 | index.md 文件 | 知识图 + index.md |
| 搜索 | grep 全文扫描 | 混合搜索（BM25 + vector + graph） |
| 置信度 | 无 | 每条事实带 confidence |
| 层级 | 3 层（raw/wiki/schema） | 4 consolidation tiers |
| 实体关系 | wikilink | typed graph edges |
| 自动化 | 手动触发 | event-driven hooks |

### 9.3 v2 数据模型增强

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

---

## 10. Non-goals (v1)

- 不暴露任何编程工具（bash, edit, write, read）— ✅ 已通过 `noTools: "all"` 实现
- 不支持运行时切换 wiki 绑定 — ✅ 一次只绑定一个 wiki
- 不引入向量数据库或 embedding — ✅ v1 用 grep 搜索
- 不实现知识图谱 — ✅ 留到 v2
- 不支持多 Agent 协作 — ✅ 留到 v2
