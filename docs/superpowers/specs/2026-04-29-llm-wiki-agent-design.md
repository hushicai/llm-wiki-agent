# llm-wiki-agent v1 Design

基于 pi-coding-agent SDK 二次开发，聚焦 wiki 操作的个人知识库 Agent。

## Architecture

```
llm-wiki-agent/
├── src/
│   ├── cli.ts             # CLI 入口 (wiki.ts)
│   ├── config.ts          # 配置管理 (~/.llm-wiki-agent/)
│   ├── runtime.ts         # createWikiSession() — 包装 createAgentSession()
│   ├── tools/
│   │   ├── index.ts       # createWikiTools()
│   │   ├── wiki-read.ts
│   │   ├── wiki-write.ts
│   │   ├── wiki-search.ts
│   │   ├── wiki-list.ts
│   │   ├── wiki-ingest.ts
│   │   └── wiki-lint.ts
│   └── init.ts            # wiki 初始化 (创建目录结构)
├── skills/                # wiki-ingest, wiki-query workflows
├── references/            # v1, v2 参考文档
└── tests/
```

## Dependency

```json
{
  "@mariozechner/pi-coding-agent": "^0.70.5",
  "@mariozechner/pi-ai": "^0.70.5"
}
```

不直接依赖 `pi-agent-core`，通过 pi-coding-agent 间接使用。

## Core: createWikiSession()

包装 `createAgentSession()`，固定配置：

```typescript
async function createWikiSession(options: {
  wikiRoot: string;       // wiki 知识库路径
  model?: Model<any>;     // 可选模型覆盖
  thinkingLevel?: ThinkingLevel;
}) {
  const agentDir = "~/.llm-wiki-agent";
  const wikiSlug = slugify(path.basename(options.wikiRoot));
  const sessionDir = path.join(agentDir, "sessions", wikiSlug);

  const { session } = await createAgentSession({
    agentDir,
    noTools: "all",                              // 禁用所有内置编程工具
    customTools: createWikiTools({ wikiRoot }),   // 只暴露 wiki 工具
    sessionManager: SessionManager.create(options.wikiRoot, sessionDir),
    model: options.model,
    thinkingLevel: options.thinkingLevel,
  });

  return session;
}
```

## Configuration

独立配置目录 `~/.llm-wiki-agent/`，与 `~/.pi/agent/` 完全隔离：

```
~/.llm-wiki-agent/
├── auth.json        (API key)
├── models.json      (provider 配置)
├── settings.json    (默认模型、thinking level)
└── sessions/
    ├── <wiki-slug>/ (按 wiki 隔离的会话历史)
    │   ├── 01H.../
    │   └── 01H.../
    └── <wiki-slug>/
```

`models.json` 格式复用 pi 的 schema，用户自行配置 provider 和模型。

## CLI Interface

```
wiki --wiki <path> [options] [query]

Options:
  --wiki, -w <path>    Wiki 知识库路径 (必填)
  --init, -i           初始化 wiki 目录结构
  --model <id>         指定模型 (覆盖默认)
  --version            版本号
  --help               帮助

Modes:
  wiki --wiki ./my-wiki "React hooks?"
    → PrintMode: 一次性查询，输出结果后退出

  wiki --wiki ./my-wiki
    → InteractiveMode: 进入交互式 TUI

  wiki --wiki ./my-wiki --init
    → 创建 wiki 目录结构后退出
```

## Wiki Directory Structure

```
<wiki-root>/
├── index.md            (页面索引，LLM 维护)
├── log.md              (操作日志，LLM 维护)
├── raw/                (原始来源，只读)
│   └── ...             (文章、笔记、PDF 等)
├── skills/             (工作流定义)
│   ├── wiki-ingest.md
│   └── wiki-query.md
├── entities/           (实体页面)
├── concepts/           (概念页面)
└── pages/              (通用页面)
```

## Tools (6个)

所有工具实现为 pi-coding-agent 的 `ToolDefinition`。

| Tool | Input | Output | Description |
|------|-------|--------|-------------|
| `wiki_read` | path, offset?, limit? | 页面内容 (markdown) | 读取 wiki 页面，支持分页 |
| `wiki_write` | path, content, mode? | 写入结果 | 创建/更新 wiki 页面。mode: overwrite, append, update_frontmatter |
| `wiki_search` | query, max_results? | 匹配列表 + 摘要 | 搜索 wiki 内容。v1 用 ripgrep/grep，v2 可换混合搜索 |
| `wiki_list` | path?, depth? | 目录树 | 列出 wiki 目录结构 |
| `wiki_ingest` | source_path | 源内容 | 读取 raw/ 下源文件，返回给 LLM 处理 |
| `wiki_lint` | scope? | 检查报告 | 检查 wiki 健康。scope: all, recent, page:<path> |

## Data Flow

```
用户输入
  → AgentSession.prompt()
    → Agent 循环 → LLM 推理 → 工具调用
      → WikiTool.execute()
        → 文件系统操作
      → 结果返回 LLM
    → LLM 生成回复 (streaming)
  → 输出到终端
```

## Session Management

- 按 wiki 隔离：`sessions/<wiki-slug>/`
- 复用 pi-coding-agent 的 SessionManager（compaction、恢复、模型切换历史）
- 启动时自动恢复未完成会话

## v2 Extension Points

| v2 功能 | 扩展方式 |
|---------|---------|
| 置信度/遗忘 | `wiki_write` frontmatter 扩展字段 |
| 知识图谱 | 新增 `wiki_graph` 工具 |
| 混合搜索 | `wiki_search` 内部实现替换 |
| 自动化 hooks | pi Extension 系统 |
| 多 Agent | 新增协作层 |

v1 工具接口保持稳定，v2 只改内部实现。

## Non-goals (v1)

- 不暴露任何编程工具 (bash, edit, write, read)
- 不支持运行时切换 wiki 绑定
- 不引入向量数据库或 embedding
- 不实现知识图谱
- 不支持多 Agent 协作
