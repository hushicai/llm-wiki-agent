# llm-wiki-agent v1 Implementation Plan

**Goal:** 基于 pi-coding-agent SDK 构建 wiki 知识库 Agent，包含 6 个 wiki 工具、CLI/TUI 模式、自动 bookkeeping。

**Architecture:** 使用 pi-coding-agent 的 `createAgentSessionRuntime()` + `createAgentSession()`，禁用所有内置编程工具（`noTools: "all"`），注册 wiki 工具为 `customTools`。配置目录 `~/.llm-wiki-agent/` 独立于 `~/.pi/agent/`。

**Tech Stack:** `@mariozechner/pi-coding-agent ^0.70.5`, `@mariozechner/pi-ai ^0.70.5`, bun runtime, yaml, typebox

---

### Phase 1: 核心骨架

#### Task 1: 项目结构与依赖

**Objective:** 搭建项目骨架，切换依赖到 pi-coding-agent

**Files:**
- Modify: `package.json`
- Delete: `src/agents.ts`, `src/session.ts`, `src/tui.ts`

**变更：**
- 替换 `@mariozechner/pi-agent-core` 为 `@mariozechner/pi-coding-agent`
- 添加 `typebox`、`yaml` 依赖
- 删除旧的手写 Agent/REPL/session 文件

#### Task 2: 配置系统

**Objective:** 实现 `~/.llm-wiki-agent/` 独立配置目录

**Files:**
- Create: `src/config.ts`

**实现：**
- `getAgentDir()` → `~/.llm-wiki-agent/`
- `getSessionDir(wikiSlug)` → `~/.llm-wiki-agent/sessions/<slug>/`
- `getModelsPath()`, `getAuthPath()`, `getSettingsPath()`
- `slugify()` 工具函数

#### Task 3: 运行时组装

**Objective:** 实现 `createWikiSession()` 包装 pi-coding-agent 运行时

**Files:**
- Create: `src/runtime.ts`

**实现：**
- 使用 `createAgentSessionServices()` + `createAgentSessionRuntime()`
- 6 个 wiki 工具注册，`noTools: "all"`
- `noSkills: true` 阻断外部技能
- `~/.llm-wiki-agent/skills/` 白名单
- 异步 context window 探测（`/v1/models` 端点）

#### Task 4: Wiki 初始化

**Objective:** 实现 `ensureWiki()` 自愈初始化

**Files:**
- Create: `src/init.ts`

**实现：**
- 创建目录：`raw/`、`entities/`、`concepts/`、`pages/`
- 创建文件：`.wikiconfig.yaml`、`AGENTS.md`、`index.md`、`log.md`
- `loadWikiConfig()` 读取配置

#### Task 5: CLI 入口

**Objective:** 实现 CLI 入口，支持交互模式和管道模式

**Files:**
- Create: `src/cli.ts`

**实现：**
- `--wiki` / `-w` 参数解析
- 交互模式：`InteractiveMode`
- 管道模式：`echo "query" | llm-wiki-agent --wiki <path>`
- 自动初始化：启动时 `ensureWiki()`

---

### Phase 2: 6 个 Wiki 工具

#### Task 6: 工具工厂

**Objective:** 实现 `createWikiTools()` 注册所有工具

**Files:**
- Create: `src/tools/index.ts`
- Create: `src/tools/wiki-read.ts`
- Create: `src/tools/wiki-write.ts`
- Create: `src/tools/wiki-search.ts`
- Create: `src/tools/wiki-list.ts`
- Create: `src/tools/wiki-ingest.ts`
- Create: `src/tools/wiki-lint.ts`
- Create: `src/types.ts`（TypeBox schemas）

#### Task 7: wiki_read

- 读取 wiki 页面或 raw source
- 支持 offset/limit 分页
- mode 参数切换 wiki/raw 目录

#### Task 8: wiki_write（含自动 bookkeeping）

- 创建/更新 wiki 页面
- 自动 frontmatter 管理：`created`（新页面）、`updated`（更新）
- 自动 index.md 维护：新页面追加 `- [[Page Title]]`
- 自动 log.md 维护：每次写入追加操作记录
- `mode: "create"` 时文件已存在返回错误

#### Task 9: wiki_search

- 按关键词搜索 wiki/raw 内容
- scope 参数：wiki/raw/all
- limit 参数控制返回结果数
- 大小写不敏感匹配

#### Task 10: wiki_list

- 列出 wiki 目录结构
- format 参数：tree/flat

#### Task 11: wiki_ingest

- 读取 raw/ 下源文件，返回内容给 LLM 处理
- 文件不存在时返回错误

#### Task 12: wiki_lint（含增强检测）

- 基础检查：missing index.md、empty directories
- Orphan page 检测：wiki/ 中存在但 index.md 中未引用的页面
- Broken wikilink 检测：`[[Page Name]]` 指向不存在的页面
- 支持 frontmatter.title 和文件名匹配

---

### Phase 3: 测试

#### Task 13: 单元测试

| 测试文件 | 用例数 | 覆盖 |
|----------|--------|------|
| `tests/tools.test.ts` | 12 | read/write/list 工具 + frontmatter bookkeeping |
| `tests/tools-additional.test.ts` | 10 | search/ingest/lint 工具 + orphan/wikilink 检测 |
| `tests/tools-schema.test.ts` | 7 | TypeBox schema 验证 |
| `tests/config.test.ts` | 6 | 配置路径 + slugify |
| `tests/cli.test.ts` | 1 | 编译检查 |
| `tests/tui.test.ts` | 4 | InteractiveMode + skills 隔离 |
| `tests/agent-e2e.test.ts` | 12 | 初始化 + session + 工具执行 + 多 session |
| `tests/extensions.test.ts` | 6 | Extension 加载/工厂/错误/隔离 |
| `tests/edge-cases.test.ts` | 41 | 边界情况：空文件、特殊字符、路径穿越、Unicode 等 |
| `tests/frontmatter.test.ts` | 11 | Frontmatter 解析/格式化/合并 |

#### Task 14: Frontmatter 工具函数

**Files:**
- Create: `src/frontmatter.ts`

**实现：**
- `parseFrontmatter(content)` — 解析 YAML frontmatter
- `stripFrontmatter(content)` — 去掉 frontmatter
- `formatFrontmatter(fm)` — 对象格式化为 frontmatter 字符串
- `mergeFrontmatter(existing, overrides)` — 合并 frontmatter
