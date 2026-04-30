# llm-wiki-agent 技术选型报告

> 为什么选择基于 pi-coding-agent 自研专用 Agent，而非通用 Agent + Skills 方案

---

## 1. 背景与问题

llm-wiki-agent 的目标是实现 [Andrej Karpathy 的 LLM Wiki 理念](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)——一个由 LLM 维护的、持续积累的个人知识库。v1 已经实现基础的 ingest/query/lint 操作，v2 规划了更复杂的能力：记忆生命周期、知识图谱、混合搜索、自动化事件驱动等。

技术选型的核心问题是：**应该用现成的通用 Agent（Claude Code / Codex / Hermes）配合 skills 来驱动 wiki，还是自研一个专用 Agent？**

---

## 2. 两种路径概览

### 路径 A：自研专用 Agent（当前方案）

用 pi-coding-agent SDK 编写一个专门的 `llm-wiki-agent` 二进制，只做 wiki 维护这一件事。内置 6 个 wiki 工具（read/write/search/list/ingest/lint），禁用所有通用编程工具。

```
llm-wiki-agent --wiki ./my-wiki         # 交互模式
echo "React hooks?" | llm-wiki-agent --wiki ./my-wiki   # 管道查询
```

### 路径 B：通用 Agent + Skills

用现成的 Agent（Claude Code / Codex / Hermes），在 AGENTS.md 或 skills 里定义 wiki 工作流，让 Agent 使用其内置的文件读写工具来操作 wiki。

```markdown
## Wiki Workflow
当你看到 `--wiki ./my-wiki` 时：
1. 读取 index.md 了解结构
2. 用 read/write 工具操作 .md 文件
3. 维护 index.md 和 log.md
```

---

## 3. 决策因素分析

### 3.1 工具面控制——否决项

**问题：通用 Agent 的内置工具无法精确关闭。**

通用 Agent（Claude Code、Codex、Hermes）默认携带一套通用编程工具：

| 工具 | 通用 Agent | 自研 Agent |
|---|---|---|
| bash | ✅ 有 | ❌ 无（noTools: "all"） |
| edit/write | ✅ 有 | ❌ 无 |
| read | ✅ 有 | ✅ 仅限 wiki_read |
| 文件搜索 | ✅ 有 | ✅ 仅限 wiki_search |
| 网络访问 | ✅ 有 | ❌ 无 |

一个 wiki 维护 Agent 不需要 bash，不需要编辑任意文件，不需要联网。如果你给一个通用 Agent 配了 wiki skills，它随时可以绕过你定义的工作流直接用 bash 改文件。这不是理论风险，而是实践中频繁发生——Agent 发现用 bash 比走你定义的 skill 步骤更"高效"。你精心设计的 wiki 工作流（先读 index、再查相关页面、更新 index、追加 log），Agent 可能用 `echo "xxx" >> file.md` 就跳过了。

**结论：工具面隔离是自研 Agent 的硬理由，skills 方案给不了。**

### 3.2 Session 隔离——每个 wiki 独立记忆

Wiki 的核心是**持续积累**。昨天问过的问题、今天新 ingest 的源、上周做过的 lint——这些需要跨会话的上下文。

| 维度 | 自研 Agent | 通用 Agent + Skills |
|---|---|---|
| Session 存储 | `~/.llm-wiki-agent/sessions/<wiki-slug>/`，按 wiki 隔离 | Agent 自身的 session 目录，混在一起 |
| Compaction | 按 wiki 内容做智能压缩 | 通用压缩策略，不感知 wiki 结构 |
| 上下文注入 | 启动时加载 index.md + 最近操作日志 + 相关实体页面 | 需要手动指定或靠 skill 提示 |

自研 Agent 可以做到 session 按 wiki slug 隔离，启动时自动恢复上次的上下文。同时维护两个 wiki（技术研究 + 读书笔记），它们的会话历史完全独立，不会互相污染。通用 Agent 的 session 是全局的，切到第二个 wiki 时，上一个 wiki 的上下文还在 prompt 里，浪费 token 且可能混淆。

### 3.3 v2 扩展需要代码级基础设施

v2 的关键特性无法通过纯 prompt（skills）实现：

| v2 特性 | 需要什么 | Skills（纯 prompt）能否做到 |
|---|---|---|
| 置信度评分 | 数据库 + 定时衰减计算 | ❌ 无持久化能力 |
| 知识图谱 | 图存储 + 遍历算法 | ❌ 无法实现递归遍历 |
| 混合搜索 | BM25 + 向量 + 图融合 | ❌ 纯 prompt 做不了搜索 |
| 合并层级 | 定时 pipeline + 数据迁移 | ❌ 没有定时能力 |
| 自动化 hooks | 事件系统 | △ 靠 Agent 自身 hook，不可控 |
| 多 Agent 协作 | 共享存储 + 冲突检测 | ❌ |

**Skills 本质是 prompt——给 LLM 一段文本描述怎么做。** 对于复杂的、有状态的、需要算法的操作，prompt 不够可靠。Agent 可能"忘记"更新置信度，可能"跳过"图遍历步骤，可能"偷懒"用 bash 直接写文件而不是走定义的写入流程。

**自研 Agent 可以在工具内部用代码实现这些复杂逻辑，然后在 LLM 推理层之上调度。** 这是唯一能同时做到"有状态 + 有算法 + 有调度"的方案。例如 wiki_lint 不是一个"告诉 Agent 去检查"的 prompt，而是一个调用 SQLite 递归 CTE 做图遍历、计算置信度衰减、返回结构化报告的代码函数。

### 3.4 依赖面——pi-coding-agent 是最轻量的 Agent SDK

| SDK | Runtime | 体积 | 内置能力 | bun 兼容 |
|---|---|---|---|---|
| pi-coding-agent | bun | ~500KB | Agent session, tools, TUI, extensions, skills, compaction | 原生 |
| LangChain.js | Node.js | ~5MB+ | 各种 chain, memory, vector store 集成 | 兼容但重 |
| Vercel AI SDK | Node.js | ~2MB | 流式、工具调用、RAG | 兼容 |
| 自撸 Agent 循环 | 任意 | 0 | 什么都没有 | 随意 |

pi-coding-agent 在"轻量"和"能力"之间找到了一个平衡点：它提供了 agent loop、session 管理、TUI、extension 系统，但没提供不需要的东西（向量存储、RAG pipeline、agent 编排）。对于 wiki 这个场景，不需要 RAG pipeline，不需要多 Agent 编排，不需要 chain。pi-coding-agent 的 feature set 刚好对齐需求。

如果自撸 Agent 循环，需要自己实现：LLM 调用 + 流式解析 + 工具调用循环 + session 持久化 + compaction + TUI。这些加起来至少 2000-3000 行，且大概率不如 pi-coding-agent 成熟。

---

## 4. 决策树

```
要做一个 wiki 知识库 Agent
│
├─ 工具面需要严格隔离？─── 是 → 排除通用 Agent + Skills
│   └─ 否 → 可以用 Claude Code + wiki skills
│
├─ 需要跨会话积累？─── 是 → 自研 Agent 按 wiki 隔离 session
│   └─ 否 → 可以用通用 Agent
│
├─ 需要 v2 复杂能力（图/搜索/记忆）？─── 是 → 需要代码级实现，prompt 不够
│   └─ 否 → 可以先用 skills 顶
│
└─ 结论：自研 Agent 是唯一能同时满足三个条件的方案
    └─ pi-coding-agent 提供了最轻量的起点
```

---

## 5. 结论

选择自研 Agent（pi-coding-agent）而不是通用 Agent + Skills 的核心原因：

| # | 因素 | 类型 | 说明 |
|---|------|------|------|
| 1 | **工具面隔离** | 否决项 | wiki Agent 不需要 bash，通用 Agent 关不掉 |
| 2 | **Session 隔离** | 架构需求 | 每个 wiki 独立会话历史，支持持续积累 |
| 3 | **代码级扩展** | 架构需求 | v2 的图/搜索/记忆需要算法实现，prompt 不够用 |
| 4 | **依赖匹配** | 成本考量 | pi-coding-agent 提供 agent 基础设施，不提供不需要的 RAG/编排 |
| 5 | **自撸成本** | 成本考量 | 自撸 agent loop 需 2000-3000 行，且不如 pi-coding-agent 成熟 |

**pi-coding-agent 不是"不得不选"的 SDK，而是"刚好够用"的 SDK。** 它提供了 agent loop + session + TUI + extension 作为底座，然后让出知识层让项目自行构建。这正是 wiki 这个场景需要的——不要一个全栈框架，要一个可以往上加东西的轻量底座。

---

## 6. 附录：pi-coding-agent 关键能力清单

| 能力 | 用途 |
|---|---|
| `createAgentSession()` | Agent 会话生命周期管理 |
| `ToolDefinition` | 自定义工具注册（6 个 wiki 工具） |
| `InteractiveMode` | 交互式 TUI |
| `runPrintMode` | 管道查询模式 |
| `SessionManager` | 会话持久化、compaction、恢复 |
| `Extension` 系统 | 事件 hooks（beforeAgentStart, turnEnd, toolCall 等） |
| `ModelRegistry` | 多 provider 管理 |
| `SettingsManager` | 配置管理 |
| `Skills` 加载 | 支持 skills 目录 |
| `noTools` | 禁用内置工具 |
