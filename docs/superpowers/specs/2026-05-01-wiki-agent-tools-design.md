# Wiki Agent 工具配置设计

**Date:** 2026-05-01
**Status:** Approved

## 背景

cli、server、subagent 都调用 `WikiAgent.createSession()`，但工具配置需求不同：

| 入口 | 内置工具 | 自定义工具 |
|------|---------|----------|
| cli/server | 需要禁用 | wiki_delegate_task |
| subagent | 保留（不传 tools） | 无 |
| test/benchmark | 禁用 | wiki_delegate_task |

## 架构

wiki 功能分三层：

- **内置工具**（pi-coding-agent 提供）：read, write, search, bash, terminal 等
- **自定义工具**（仓库定义）：`wiki_delegate_task`（唯一自定义工具）
- **Wiki 技能**（`~/.llm-wiki-agent/skills/`）：wiki-ingest, wiki-query, wiki-lint — 由 resourceLoader 加载，所有入口共享

技能不经过 tools 参数，由 `resourceLoaderOptions.additionalSkillPaths` 控制。

## API

```typescript
class WikiAgent {
  async createSession(cwd: string, options?: {
    tools?: (string | ToolDefinition)[];
  }): Promise<AgentSessionRuntime>
}
```

### 内部过滤逻辑

遍历 `tools` 数组，自动分组：
- `string` 类型 → 内置工具名 → 加入 `tools` 白名单
- `ToolDefinition` 类型 → 自定义工具 → 加入 `customTools` 数组

**关键区分：**
- `options.tools` 为 `undefined`（不传）→ 使用 pi 默认内置工具（subagent 行为）
- `options.tools` 为 `[]`（空数组）→ 禁用所有内置工具，不传自定义工具
- `options.tools` 为非空数组 → 按内容分组传入

```typescript
if (options?.tools !== undefined) {
  // 显式传了 tools = caller 明确指定工具集
}
// 不传 = pi 默认
```

## 文件修改清单

### src/core/agent.ts

修改 `createSession()`，区分 `undefined` 和 `[]` 的情况。

### src/tools/index.ts（新建）

统一的工具工厂：

```typescript
import { createWikiDelegateTaskTool } from "./delegate-task.js";
export function createWikiTools(wikiRoot: string): ToolDefinition[] {
  return [createWikiDelegateTaskTool(wikiRoot)];
}
```

### src/tools/delegate-task.ts

修复 `subAgent` 未定义 bug：

```typescript
const subAgent = new WikiAgent();
const runtime = await subAgent.createSession(neutralCwd);
```

### src/cli.ts

```typescript
import { createWikiTools } from "./tools/index.js";
await agent.createSession(wikiRoot, { tools: createWikiTools(wikiRoot) });
```

### src/server/session.ts

同上。

### src/core/runtime.ts（合并）

`createWikiSession()` 改为调用 `WikiAgent.createSession()`，废除独立路径。

## 入口配置矩阵（最终）

| 入口 | tools 传参 | 内置工具 | 自定义工具 | 技能 |
|------|-----------|---------|----------|------|
| CLI | `[delegateTool]` | 无 | wiki_delegate_task | wiki-* |
| Server | `[delegateTool]` | 无 | wiki_delegate_task | wiki-* |
| Subagent | 不传（undefined） | pi 默认全部 | 无 | wiki-* |
| Test/Benchmark | `[delegateTool]` | 无 | wiki_delegate_task | wiki-* |

## 自验

- [x] cli 启动无内置工具，有 delegate_task
- [x] server 无内置工具，有 delegate_task
- [x] subagent 有内置工具，无自定义工具
- [x] runtime.ts 复用 WikiAgent，无重复逻辑
