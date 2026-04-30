# llm-wiki-agent

基于 [pi-coding-agent SDK](https://github.com/badlogic/pi-mono) 的个人知识库 Agent，实现 [Andrej Karpathy 的 LLM Wiki 理念](https://gist.github.com/karpathy/442a6bf555914893e9891c19de94f)——一个由 LLM 维护的、持续积累的个人知识库。

## Quick Start

```bash
# 交互模式（目录不存在则自动初始化）
llm-wiki-agent --wiki ~/my-wiki

# 管道模式
echo "React hooks 是什么？" | llm-wiki-agent --wiki ~/my-wiki

# 查看帮助
llm-wiki-agent --help
```

## 架构

### Wiki 目录结构

```
<wiki-root>/
├── AGENTS.md           # Schema — LLM 操作指南（init 自动生成）
├── index.md            # 页面索引（wiki_write 自动维护）
├── log.md              # 操作日志（wiki_write 自动维护）
├── raw/                # 源文件（用户放置，只读）
└── wiki/               # 结构化文档（LLM 创建和维护，平铺）
```

设计原则：
- **两层对应**：`raw/` 输入层 + `wiki/` 输出层，根目录只放元文件
- **全平铺**：`wiki/` 下不分 entity/concept 子目录，LLM 不需要做分类决策
- **元数据驱动**：分类靠 frontmatter 的 `type` 和 `tags` 字段，不靠目录结构
- **自动 bookkeeping**：index.md、log.md、frontmatter 时间戳由工具自动维护

### 页面格式

```markdown
---
title: React Server Components
type: concept          # entity | concept | note
tags: [react, frontend]
created: 2026-04-29
updated: 2026-04-29
sources:
  - raw/article.md
---

# React Server Components

正文内容...
```

## 功能

### 当前实现

| 模块 | 状态 | 说明 |
|------|------|------|
| CLI 入口 | 完成 | 交互模式 + 管道模式，自愈初始化 |
| Config | 完成 | `~/.llm-wiki-agent/` 独立配置目录，与 `~/.pi/agent/` 隔离 |
| Wiki 初始化 | 完成 | 自动创建目录结构、AGENTS.md、index.md、log.md |
| Frontmatter | 完成 | 解析/格式化/合并/剥离 YAML frontmatter |
| wiki_read | 完成 | 受限路径读取（仅 wiki/、raw/、root 元文件），支持分页 |
| wiki_write | 完成 | 自动管理 frontmatter 时间戳、index.md 追加、log.md 记录、重复检测 |
| wiki_search | 完成 | grep 全文搜索，返回匹配文件完整内容 |
| wiki_list | 完成 | 目录列表，支持 tree/flat 格式 |
| wiki_lint | 完成 | orphan page、broken wikilink、missing index.md、空目录检测，支持自动修复 |
| wiki_ingest | 未实现 | 文件为空，待开发 |
| 上下文窗口探测 | 完成 | 从 `/v1/models` 自动探测自定义模型 context window |
| 系统提示词 | 完成 | 中文系统提示词，严格约束 LLM 行为（严禁编造、必须检索后才回答） |

### 当前架构状态

项目处于**过渡期**。6 个自定义工具（read/write/search/list/ingest/lint）已实现为 ToolDefinition，但运行时当前配置为 **Skills-based v1 模式**——工具不注册为自定义工具，而是从 `~/.llm-wiki-agent/skills/` 加载为技能（wiki-ingest、wiki-query、wiki-lint）。

**v1 精简计划**（见设计文档）：
- 放开 pi 原生工具（bash、read_file、write_file 等）
- 保留 3 个自定义工具：wiki_search、wiki_write、wiki_lint
- 移除 wiki_read、wiki_list、wiki_ingest（由原生工具替代）
- Wiki 结构改为 `raw/` + `wiki/` 平铺（已反映在上方目录结构中）

### 典型工作流

**录入**
```
用户: "帮我处理 raw/article.md"
  → LLM: cat raw/article.md（或 read_file）
  → LLM: 分析内容
  → LLM: wiki_write({ path: "xxx.md", content: "..." })
  → 自动: frontmatter 时间戳、index.md 追加、log.md 记录
```

**查询**
```
用户: "React 是什么？"
  → LLM: wiki_search({ query: "React" })
  → 返回匹配页面完整内容
  → LLM: 综合回答，注明来源
```

**健康检查**
```
用户: "检查 wiki 健康"
  → LLM: wiki_lint({ fix: true })
  → 返回检查报告 + 修复结果
```

## 安装

```bash
# 全局安装
bun link

# 或直接运行
bun run src/cli.ts --wiki ~/my-wiki
```

## 配置

独立配置目录 `~/.llm-wiki-agent/`：

```
~/.llm-wiki-agent/
├── auth.json         # API key
├── models.json       # Provider 配置
├── settings.json     # 默认模型、thinking level
├── skills/           # Skills-based v1 模式下的技能文件
└── sessions/         # 按 wiki 隔离的会话历史
```

### models.json

```json
{
  "providers": {
    "custom-deepseek": {
      "baseUrl": "http://llm.example.com/api/oai/v1",
      "api": "openai-completions",
      "apiKey": "***",
      "models": [
        { "id": "deepseek-v4", "input": ["text"] }
      ]
    }
  }
}
```

### settings.json

```json
{
  "defaultProvider": "custom-deepseek",
  "defaultModel": "deepseek-v4",
  "defaultThinkingLevel": "medium"
}
```

## 开发

```bash
# 安装依赖
bun install

# 运行测试
bun test

# 构建
bun run build
```

### 测试状态

**84 测试用例，69 通过，15 失败**（截至 v0.1.0）。

15 个失败用例原因：
- `createWikiTools()` 当前返回空数组（Skills-based v1 模式），导致注册相关测试失败
- AGENTS.md 模板未更新为 `raw/` + `wiki/` 平铺结构
- 运行时未注册自定义工具，工具执行测试失败

修复路径见 [v1-redesign 设计文档](docs/superpowers/specs/2026-04-29-llm-wiki-agent-v1-redesign.md)。

### 项目结构

```
src/
├── cli.ts              # CLI 入口（交互模式 + 管道模式）
├── config.ts           # 配置路径管理（~/.llm-wiki-agent/）
├── runtime.ts          # createWikiSession() — 运行时组装
├── init.ts             # Wiki 初始化（自愈）
├── frontmatter.ts      # Frontmatter 解析/格式化/合并
├── types.ts            # TypeBox schemas + 类型定义
├── templates/
│   ├── system-prompt-template.md   # LLM 系统提示词模板
│   └── wiki-schema-template.md     # AGENTS.md 生成模板
└── tools/
    ├── index.ts        # createWikiTools() 注册
    ├── wiki-read.ts    # 受限路径读取，支持分页
    ├── wiki-write.ts   # 自动 bookkeeping（frontmatter/index/log/重复检测）
    ├── wiki-search.ts  # grep 全文搜索
    ├── wiki-list.ts    # 目录列表（tree/flat）
    ├── wiki-ingest.ts  # 未实现（空文件）
    └── wiki-lint.ts    # orphan page + broken wikilink + auto-fix
tests/
├── tools.test.ts           # write/createTools 测试
├── tools-schema.test.ts    # 工具参数 schema 测试
├── tools-additional.test.ts # search/lint 测试
├── edge-cases.test.ts      # 边界情况（空内容、特殊字符、子目录等）
├── frontmatter.test.ts     # frontmatter 解析/格式化/合并
├── config.test.ts          # 配置路径测试
├── cli.test.ts             # 构建编译测试
├── agent-e2e.test.ts       # 端到端测试
├── extensions.test.ts      # 扩展机制测试
└── tui.test.ts             # TUI 交互模式测试
```

## 设计文档

- [完整设计](docs/superpowers/specs/2026-04-29-llm-wiki-agent-design.md) — 架构、技术选型、v1/v2 规划
- [技术栈](docs/superpowers/specs/2026-04-29-llm-wiki-agent-tech-stack.md) — 选型分析
- [v1 实施计划](docs/superpowers/specs/2026-04-29-llm-wiki-agent-v1-plan.md) — v1 开发任务
- [v1 精简设计](docs/superpowers/specs/2026-04-29-llm-wiki-agent-v1-redesign.md) — 工具精简方案（3 自定义工具 + 原生工具）
- [Wiki 结构设计](docs/superpowers/specs/2026-04-29-llm-wiki-agent-wikiroot-design.md) — `raw/` + `wiki/` 平铺方案
- [v2 实施计划](docs/superpowers/specs/2026-04-29-llm-wiki-agent-v2-plan.md) — v2 路线图

## 参考来源

| 版本 | 作者 | 参考 |
|------|------|------|
| v1 | Andrej Karpathy | [karpathy/llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c19de94f) |
| v2 | Rohit Gopinath | [LLM Wiki v2](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2) |

## 致谢

- [badlogic/pi-mono](https://github.com/badlogic/pi-mono) — pi 主仓库，提供 pi-coding-agent SDK
- [Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki) — skills 模式参考
- [yologdev/yoyo-evolve](https://github.com/yologdev/yoyo-evolve) — 自主研发流程
