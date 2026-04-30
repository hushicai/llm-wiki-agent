# llm-wiki-agent

基于 [pi-coding-agent SDK](https://github.com/badlogic/pi-mono) 的个人知识库 Agent，实现 [Karpathy 的 LLM Wiki 理念](https://gist.github.com/karpathy/442a6bf555914893e9891c19de94f)。

```
┌──────────────────────────────────────────────────────────────────┐
│                         User                                    │
├──────────────────────┬──────────────────────┬───────────────────┤
│     CLI (交互)        │    CLI (管道)         │   Web UI          │
│  llm-wiki-agent -w   │  echo "q" | llm-wiki │  localhost:3000   │
└──────────┬───────────┴──────────┬───────────┴────────┬──────────┘
           │                      │                    │
           └──────────┬───────────┴──────────┬─────────┘
                      │                      │
                      ▼                      ▼
┌──────────────────────────────────┐ ┌──────────────────────────────┐
│         CLI Entry (cli.ts)       │ │    HTTP Server (server.ts)   │
│                                  │ │  POST /api/chat (SSE stream) │
│                                  │ │  Static files: web/          │
└────────────────┬─────────────────┘ └──────────────┬───────────────┘
                 │                                   │
                 └──────────┬────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                    pi-coding-agent SDK                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Session  │  │  Tools   │  │  Skills  │  │ Model Registry │  │
│  │  Manager  │  │(6 custom)│  │(3 wiki)  │  │ + Provider     │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Wiki Root (~/my-wiki)                      │
│                                                                  │
│  AGENTS.md    index.md    log.md                                 │
│  (schema)     (索引)      (操作日志)                               │
│                                                                  │
│  raw/  ──── 源文件（用户放置，只读）                                │
│  wiki/ ──── 结构化文档（LLM 创建维护）                              │
└──────────────────────────────────────────────────────────────────┘
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

独立配置目录 `~/.llm-wiki-agent/`，包含 `models.json`、`settings.json`、`skills/`、`sessions/`。

## 设计文档

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
- [Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki) — skills 模式参考
- [yologdev/yoyo-evolve](https://github.com/yologdev/yoyo-evolve) — 自主研发流程
