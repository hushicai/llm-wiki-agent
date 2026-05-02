# llm-wiki-agent Subagent 架构实现计划

**Goal:** 主 agent 只负责任务分发，3 个 subagent（ingest/query/lint）各司其职，工具集和 system prompt 完全隔离

**Architecture:** 基于 pi SDK 的 subagent extension 机制。主 agent 注册一个 `subagent` 工具，spawn `llm-wiki-agent` 子进程（带 `--mode json`）运行 subagent。Subagent 以 `noExtensions: true` 启动，避免看到主 agent 的 `subagent` 工具。

**Tech Stack:** TypeScript / Bun, `@mariozechner/pi-coding-agent` SDK

---

## Task 1: 创建 Subagent Agent 定义文件 ✅ DONE

**Objective:** 创建 3 个 subagent 定义文件在仓库 `agents/` 目录

**Files:**
- Create: `agents/wiki-ingest.md`
- Create: `agents/wiki-query.md`
- Create: `agents/wiki-lint.md`

**Directory Structure:**

```
llm-wiki-agent/
├── agents/                 # 仓库顶层，git 管理
│   ├── wiki-ingest.md
│   ├── wiki-query.md
│   └── wiki-lint.md
├── extensions/
│   └── wiki-subagent.ts    # discoverAgents 从 ./agents/ 读取
└── src/
```

---

## Task 2: CLI 改造 — 支持 `--mode json` 参数 ✅ DONE

**Objective:** CLI 支持 `--mode json` 输出 JSON 行流，供 subagent 子进程使用

**Files:**
- Modify: `src/cli.ts`

---

## Task 3: WikiAgent.createSession 支持 role + appendSystemPrompt ✅ DONE

**Objective:** `createSession` 支持 `role` 参数，用于区分主 agent 和 subagent 模式

**Files:**
- Modify: `src/core/agent.ts`

---

## Task 4: 创建仓库 extensions/ 目录 + wiki-subagent.ts ✅ DONE

**Objective:** Extension 代码放在仓库顶层 `extensions/`，不在 `src/core/extensions/`

**Files:**
- Create: `extensions/wiki-subagent.ts`

**Directory Structure:**

```
llm-wiki-agent/
├── agents/                 # subagent 定义文件
│   ├── wiki-ingest.md
│   ├── wiki-query.md
│   └── wiki-lint.md
├── extensions/             # extension 代码
│   └── wiki-subagent.ts    # discoverAgents 从 ../agents/ 读取
└── src/core/agent.ts       # 通过 extensionFactories 加载 wiki-subagent
```

---

## Task 5: WikiAgent 通过 extensionFactories 加载 wiki-subagent ✅ DONE

**Objective:** 使用 `extensionFactories` 而非 `additionalExtensionPaths` 加载 extension

**问题背景：**
SDK 的 `collectPackageResources` 期望目录结构是 `<root>/extensions/`，会在 `<root>/extensions/extensions/` 下找文件。我们的结构是 `<root>/extensions/wiki-subagent.ts`，不在 SDK 预期的位置。

**解决方案：**
使用 `extensionFactories` 动态 import extension factory，绕过 SDK 的目录发现机制。

**Files:**
- Modify: `src/core/agent.ts`

**实现：**

```typescript
import { fileURLToPath } from "url";

// 动态加载 wiki-subagent extension factory
let extensionFactories: ExtensionFactory[] = [];
if (!role) {
  try {
    const extModule = await import(join(extensionsDir, "wiki-subagent.js"));
    extensionFactories = [extModule.default];
  } catch {
    // Extension 加载失败，继续运行
  }
}

const svc = await createAgentSessionServices({
  resourceLoaderOptions: {
    noExtensions: true,
    noSkills: true,
    ...(extensionFactories.length > 0 && {
      extensionFactories,
    }),
    // Skills 暂不支持
  },
});
```

---

## Task 6: 测试 Subagent 模式 ✅ DONE

**Objective:** 验证 `llm-wiki-agent --mode json --append-system-prompt <file>` 能正常工作

**验证结果：**
- ✅ JSON 模式输出正确
- ✅ Subagent 能接收 system prompt
- ✅ 工作目录和 wiki 路径正确

---

## Task 7: 端到端测试 — 主 Agent 调用 Subagent ✅ DONE

**Objective:** 验证主 agent 能通过 `subagent` 工具调用 subagent

**验证结果：**
- ✅ Extension 正确加载
- ✅ 主 agent 能看到 `subagent` 工具
- ✅ 发现 3 个可用 agents: wiki-ingest, wiki-query, wiki-lint

---

## 实施顺序

| # | Task | 状态 | 依赖 |
|---|------|------|------|
| 1 | 创建 subagent 定义文件（`agents/wiki-*.md`） | ✅ DONE | 无 |
| 2 | CLI 改造（`--mode json` + `--append-system-prompt`） | ✅ DONE | 无 |
| 3 | WikiAgent.createSession 支持 role + appendSystemPrompt | ✅ DONE | Task 2 |
| 4 | 创建仓库 `extensions/wiki-subagent.ts` | ✅ DONE | Task 1 |
| 5 | WikiAgent 通过 extensionFactories 加载 wiki-subagent | ✅ DONE | Task 4 |
| 6 | 测试 subagent 模式 | ✅ DONE | Task 5 |
| 7 | 端到端分发测试 | ✅ DONE | Task 5 |

---

## 已完成 Commits

| Commit | 描述 |
|--------|------|
| `x1` | feat: add subagent agent definition files |
| `x2` | feat: add --mode json and --append-system-prompt support |
| `x3` | feat: WikiAgent.createSession supports role and appendSystemPrompt |
| `x4` | feat: add wiki-subagent extension |
| `x5` | fix(agent): use extensionFactories instead of additionalExtensionPaths |

---

## 关键风险点

1. **`__dirname` 回溯路径**：已解决，使用 `import.meta.url` + `fileURLToPath`
2. **SDK 目录结构假设**：已解决，使用 `extensionFactories` 绕过 SDK 发现
3. **`runPrintMode` 的 `mode: "json"` 输出格式**：已验证工作正常
