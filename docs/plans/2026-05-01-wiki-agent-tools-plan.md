# Wiki Agent 工具配置实现计划

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 修改 WikiAgent.createSession() 接收混合工具数组，自动过滤分为内置工具和自定义工具

**Architecture:** 遍历 tools 数组，string → tools 白名单，ToolDefinition → customTools

**Tech Stack:** TypeScript, pi-coding-agent SDK

---

## Task 1: 修改 agent.ts createSession 签名和过滤逻辑

**Objective:** 更新 createSession 方法签名，添加工具过滤逻辑

**Files:**
- Modify: `src/core/agent.ts:45-91`

**Step 1: 查看当前 createSession 实现**

```bash
read_file: /Users/hushicai/data/ai-project/llm-wiki-agent/src/core/agent.ts
```

**Step 2: 修改 createSession 签名和实现**

替换第 45-91 行：

```typescript
async createSession(cwd: string, options?: {
  tools?: (string | ToolDefinition)[];
}) {
  const wikiSlug = slugify(cwd.split("/").pop() || "wiki");
  const sessionDir = getSessionDir(wikiSlug);
  const sessionManager = SessionManager.create(cwd, sessionDir);

  // Filter tools into built-in and custom
  const builtInTools: string[] = [];
  const customToolsList: ToolDefinition[] = [];
  
  if (options?.tools) {
    for (const tool of options.tools) {
      if (typeof tool === "string") {
        builtInTools.push(tool);
      } else {
        customToolsList.push(tool);
      }
    }
  }

  const svc = await createAgentSessionServices({
    cwd,
    agentDir: this.agentDir,
    resourceLoaderOptions: {
      noSkills: true,
      appendSystemPrompt: this.systemPromptLines,
      ...(existsSync(join(this.agentDir, "skills")) && {
        additionalSkillPaths: [join(this.agentDir, "skills")],
      },
    },
  });

  // Cache model info for getModels()
  if (!this.cachedModels) {
    this.cachedModels = svc.modelRegistry.getAvailable().map((m: any) => ({
      id: m.id,
      provider: m.provider,
      contextWindow: m.contextWindow,
    }));
  }

  // Fire-and-forget context window probe
  this.probeContextWindows(svc);

  const runtime = await createAgentSessionRuntime(
    async (opts: any) => {
      const result = await createAgentSession({
        ...opts,
        agentDir: this.agentDir,
        resourceLoader: svc.resourceLoader,
        modelRegistry: svc.modelRegistry,
        sessionManager,
        ...(builtInTools.length > 0 && { tools: builtInTools }),
        ...(customToolsList.length > 0 && { customTools: customToolsList }),
      });
      return { ...result, services: svc, diagnostics: svc.diagnostics };
    },
    { cwd, agentDir: this.agentDir, sessionManager },
  );

  return runtime;
}
```

**Step 3: 添加 ToolDefinition import**

在文件顶部 import 中添加：
```typescript
import type { ToolDefinition } from "@mariozechner/pi-agent-core";
```

**Step 4: 运行测试验证**

```bash
cd /Users/hushicai/data/ai-project/llm-wiki-agent
bun test
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/core/agent.ts
git commit -m "refactor: simplify createSession to accept mixed tools array"
```

---

## Task 2: 更新 cli.ts 调用

**Objective:** cli 传入空工具数组验证禁用内置工具

**Files:**
- Modify: `src/cli.ts:74`

**Step 1: 查看 cli.ts 调用**

```bash
read_file: /Users/hushicai/data/ai-project/llm-wiki-agent/src/cli.ts:70-80
```

**Step 2: 修改调用**

传入空数组（这样可以禁用内置工具）：
```typescript
const runtime = await agent.createSession(wikiRoot, {
  tools: [],  // 空数组 = 禁用所有内置工具
});
```

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: cli passes empty tools to disable built-in"
```

---

## Task 3: 更新 server/session.ts 调用

**Objective:** server 传入空工具数组

**Files:**
- Modify: `src/server/session.ts`

**Step 1: 查看 session.ts 调用**

```bash
read_file: /Users/hushicai/data/ai-project/llm-wiki-agent/src/server/session.ts
```

**Step 2: 修改调用**

传入空数组：
```typescript
const runtime = await agent.createSession(wikiRoot, {
  tools: [],
});
```

**Step 3: Commit**

```bash
git add src/server/session.ts
git commit -m "feat: server passes empty tools to disable built-in"
```

---

## Task 4: 更新 delegate-task.ts subagent 调用

**Objective:** subagent 保留内置工具（不传 tools 参数）

**Files:**
- Modify: `src/tools/delegate-task.ts`

**Step 1: 查看 delegate-task.ts**

```bash
read_file: /Users/hushicai/data/ai-project/llm-wiki-agent/src/tools/delegate-task.ts:30-45
```

**Step 2: subagent 保持现状（不传 tools 参数 = 使用默认内置工具）**

这个文件不需要修改。

**Step 3: Commit**

```bash
git add src/tools/delegate-task.ts
git commit -m "refactor: subagent uses default built-in tools"
```

---

## Task 5: 最终验证

**Objective:** 确保所有入口正常工作

**Step 1: 运行完整测试**

```bash
cd /Users/hushicai/data/ai-project/llm-wiki-agent
bun test
```

Expected: PASS

**Step 2: 测试 cli**

```bash
bun run src/cli.ts --version
```

Expected: 输出版本号

**Step 3: Commit**

```bash
git add .
git commit -m "feat: implement unified tools config for WikiAgent"
```