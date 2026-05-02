# llm-wiki-agent

基于 [pi-coding-agent SDK](https://github.com/badlogic/pi-mono) 的个人知识库 Agent，实现 [Karpathy 的 LLM Wiki 理念](https://gist.github.com/karpathy/442a6bf555914893e9891c19de94f)。

## 架构

```
┌──────────────────────────────────────────────────────────────────┐
│                         User                                     │
├──────────────────────┬──────────────────────┬───────────────────┤
│     CLI (交互)        │    CLI (管道)         │   Web UI          │
│  llm-wiki-agent -w   │  echo "q" | llm-wiki │  localhost:3000   │
└──────────┬───────────┴──────────┬───────────┴────────┬──────────┘
           │                      │                    │
           └──────────┬───────────┴──────────┬─────────┘
                      │                      │
                      ▼                      ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│     CLI Entry (cli.ts)       │  │   HTTP Server (server.ts)   │
│  --mode json (subagent)      │  │   POST /api/chat (SSE)     │
└──────────────┬───────────────┘  └──────────────┬───────────────┘
               │                                   │
               └──────────────┬────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    WikiAgent (agent.ts)                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              wiki-subagent (extension)                      │ │
│  │  • 注册 subagent 工具                                        │ │
│  │  • discoverAgents() 从 agents/ 读取 agent 定义              │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────────────┘
                           │ subagent({ agent, task })
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Subagent Agents                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │   wiki-ingest   │  │   wiki-query    │  │   wiki-lint    │   │
│  │   Fetch/       │  │   检索并        │  │   健康检查      │   │
│  │   Compile      │  │   回答问题       │  │   确定性+启发式 │   │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘   │
└───────────┼─────────────────────┼────────────────────┼───────────┘
            │                     │                    │
            ▼                     ▼                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Wiki Root (~/my-wiki)                      │
│                                                                  │
│  raw/  ──── Layer 1: 源文件（不可修改）                           │
│  wiki/ ──── Layer 2: 结构化文档（LLM 创建维护）                   │
│    ├── index.md ── 全局索引                                       │
│    └── log.md ──── 操作日志（追加写入）                           │
└──────────────────────────────────────────────────────────────────┘
```

### Subagent 工具

主 agent 通过 `subagent` 工具分发任务给专门的 subagent：

| Agent | 职责 | 工作流 |
|-------|------|--------|
| `wiki-ingest` | 摄入原始资料 | Fetch → Compile → Cascade Updates → 更新 index/log |
| `wiki-query` | 检索并回答 | 读取 index → 搜索 wiki → 综合回答 → 归档（可选） |
| `wiki-lint` | 健康检查 | 确定性检查（可自动修复）+ 启发式检查（仅报告） |

### 目录结构

```
llm-wiki-agent/
├── agents/               # Subagent 定义（Markdown 格式）
│   ├── wiki-ingest.md
│   ├── wiki-query.md
│   └── wiki-lint.md
├── extensions/           # pi SDK extensions
│   └── wiki-subagent.ts  # 注册 subagent 工具
└── src/
    ├── cli.ts           # CLI 入口
    └── server.ts        # Web UI 入口

wiki-root/
├── raw/                  # Layer 1: 原始资料（不可修改）
│   └── [topic]/         # 按主题分类
├── wiki/                 # Layer 2: 编译后的知识条目
│   ├── index.md         # 全局索引
│   └── log.md           # 操作日志
└── SKILL.md             # Wiki 规范（可选）
```

## Quick Start

```bash
# 交互模式（目录不存在则自动初始化）
llm-wiki-agent --wiki ~/my-wiki

# 管道模式
echo "React hooks 是什么？" | llm-wiki-agent --wiki ~/my-wiki

# Web UI（默认端口 3000）
llm-wiki-agent serve --wiki ~/my-wiki

# 安装
bun link
```

## 配置

独立配置目录 `~/.llm-wiki-agent/`，包含 `models.json`、`settings.json`、`sessions/`。

## 设计文档

- [Subagent 架构实现计划](docs/superpowers/plans/2026-05-02-llm-wiki-agent-subagent-implementation-plan.md)
- [完整设计](docs/superpowers/specs/2026-04-29-llm-wiki-agent-design.md)
- [v1 精简设计](docs/superpowers/specs/2026-04-29-llm-wiki-agent-v1-redesign.md)
- [Wiki 结构设计](docs/superpowers/specs/2026-04-29-llm-wiki-agent-wikiroot-design.md)

## 参考来源

| 版本 | 作者 | 参考 |
|------|------|------|
| v1 | Andrej Karpathy | [karpathy/llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c19de94f) |
| v2 | Rohit Gopinath | [LLM Wiki v2](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2) |

## 致谢

- [badlogic/pi-mono](https://github.com/badlogic/pi-mono) — pi 主仓库，提供 pi-coding-agent SDK
- [Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki) — 技能模式参考
- [yologdev/yoyo-evolve](https://github.com/yologdev/yoyo-evolve) — 自主研发流程
