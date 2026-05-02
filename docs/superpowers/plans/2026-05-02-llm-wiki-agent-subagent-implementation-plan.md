# llm-wiki-agent Subagent 架构实现计划

**Goal:** 主 agent 只负责任务分发，3 个 subagent（ingest/query/lint）各司其职，工具集和 system prompt 完全隔离

**Architecture:** 基于 pi SDK 的 subagent extension 机制。主 agent 注册一个 `subagent` 工具，spawn `llm-wiki-agent` 子进程（带 `--mode json`）运行 subagent。Subagent 以 `noExtensions: true` + `noSkills: true` 启动，避免看到主 agent 的 `subagent` 工具。

**Tech Stack:** TypeScript / Bun, `@mariozechner/pi-coding-agent` SDK

---

## Task 1: 创建 Subagent Agent 定义文件

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

**Step 1: 创建 wiki-ingest.md**

```markdown
---
name: wiki-ingest
description: 将原始资料摄入 wiki。触发词：ingest、录入、add to wiki。
tools: read,bash,grep,find
---
你是一个 Wiki 知识摄入 Agent。

## 核心职责
将原始资料（raw/ 下的文件）转化为结构化 wiki 知识。

## 工作目录
{wikiRoot}

## 工作流程
1. 读取 raw/ 下的源文件，理解内容
2. 识别关键实体、概念、关系
3. 按 frontmatter 格式写入 wiki/ 条目
4. 更新 index.md（新增条目）

## 严禁行为
- 不得修改不在 ingest 任务范围内的文件
- 不得凭空创造知识
- 不得在 wiki 中已有相关条目时重复创建
```

**Step 2: 创建 wiki-query.md**

```markdown
---
name: wiki-query
description: 在 wiki 中检索并回答问题。触发词：search wiki、find、tell me about。
tools: read,grep,find
---
你是一个 Wiki 知识检索 Agent。

## 核心职责
在 wiki 中检索知识，回答用户问题。

## 工作目录
{wikiRoot}

## 回答要求
- 必须先检索 wiki，再作答
- 引用来源必须标注具体条目名
- wiki 中无相关信息时，明确告知

## 严禁行为
- 不得凭空编造知识
- 不得修改任何 wiki 文件
```

**Step 3: 创建 wiki-lint.md**

```markdown
---
name: wiki-lint
description: 检查并修复 wiki 问题。触发词：lint、health check、检查、clean up wiki。
tools: read,write,bash,grep
---
你是一个 Wiki 质量检查 Agent。

## 核心职责
检查 wiki 结构完整性和内容质量。

## 工作目录
{wikiRoot}

## 检查项
- orphan：被引用但不存在
- broken_link：链接失效
- index 不一致：index.md 与实际文件不符
- 缺少 frontmatter

## 工作流程
1. 扫描 wiki/ 目录结构
2. 逐个检查问题
3. 自动修复（fix: true）或报告

## 严禁行为
- 不得修改不在问题范围内的文件
```

**Step 4: 验证目录存在**

```bash
mkdir -p ~/.llm-wiki-agent/agents
# 将上述3个文件写入该目录
```

**Step 4: Commit**

```bash
mkdir -p agents
# 创建3个md文件
git add agents/
git commit -m "feat: add subagent agent definition files"
```

---

## Task 2: CLI 改造 — 支持 `--mode json` 参数

**Objective:** CLI 支持 `--mode json` 输出 JSON 行流，供 subagent 子进程使用

**Files:**
- Modify: `src/cli.ts`

**Step 1: 添加 import**

```typescript
import { InteractiveMode, runPrintMode } from "@mariozechner/pi-coding-agent";
```

**Step 2: 解析 `--mode json` 参数**

在 `main()` 函数中，`wikiRoot` 解析之后添加：

```typescript
// Parse --mode
const modeIndex = args.indexOf("--mode");
const mode = modeIndex !== -1 ? args[modeIndex + 1] : undefined;
// 支持 "interactive"(默认), "json"
const isJsonMode = mode === "json";
```

**Step 3: 解析 `--append-system-prompt` 参数**

在 `--mode` 解析之后添加：

```typescript
// Parse --append-system-prompt (可多次指定)
const appendPromptFiles: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--append-system-prompt" && i + 1 < args.length) {
    appendPromptFiles.push(args[i + 1]);
    i++;
  }
}
```

**Step 4: 读取追加的 system prompt 内容**

```typescript
// 合并追加的 system prompt
const appendedPrompts: string[] = [];
for (const filePath of appendPromptFiles) {
  try {
    const content = readFileSync(filePath, "utf-8");
    appendedPrompts.push(content);
  } catch {
    // ignore missing files
  }
}
```

**Step 5: 修改 createSession 调用，传入 appendSystemPrompt**

修改 `createSession` 调用：

```typescript
const runtime = await agent.createSession(wikiRoot, {
  appendSystemPrompt: appendedPrompts,
});
```

**Step 6: 判断使用 runPrintMode 还是 InteractiveMode**

在 `pipedQuery` 分支中已经有 `session.prompt` 调用。JSON 模式的 task 从 positional args 获取：

```typescript
// 获取 positional task（--mode json 时）
const positionalIndex = args.findIndex((a) => !a.startsWith("-") && a !== "llm-wiki-agent");
const positionalTask = positionalIndex !== -1 ? args.slice(positionalIndex).join(" ") : undefined;

// 对于 JSON 模式，用 positionalTask
if (isJsonMode && positionalTask) {
  await runPrintMode(runtime, { mode: "json", initialMessage: positionalTask });
  await runtime.dispose();
  await agent.dispose();
  return;
}
```

**Step 7: 更新 printHelp()**

```typescript
function printHelp(): void {
  console.log(`
llm-wiki-agent — Wiki Knowledge Agent CLI

Usage:
  llm-wiki-agent --wiki <path>        Interactive mode (auto-inits if needed)
  echo "query" | llm-wiki-agent --wiki <path>   Pipeline query
  llm-wiki-agent --wiki <path> --mode json --append-system-prompt <file> <task>  Subagent mode
  llm-wiki-agent --version            Show version
  llm-wiki-agent --help               Show this help

Options:
  --wiki, -w <path>     Wiki root directory (required)
  --mode <mode>        Output mode: interactive (default), json
  --append-system-prompt <file>  Append file contents to system prompt (can repeat)
  --version             Show version
  --help                Show this help

Examples:
  llm-wiki-agent --wiki ./my-wiki
  llm-wiki-agent --wiki ./my-wiki --mode json --append-system-prompt ./prompt.md "任务描述"
`);
}
```

**Step 8: 添加 readFileSync import**

```typescript
import { existsSync, readFileSync } from "fs";
```

**Step 9: Run 验证**

```bash
cd /Users/hushicai/data/ai-project/llm-wiki-agent
# 验证 CLI 参数解析正确
./dist/cli.js --help
# 预期：输出包含 --mode 和 --append-system-prompt
```

**Step 10: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --mode json and --append-system-prompt support"
```

---

## Task 3: WikiAgent.createSession 支持 role + appendSystemPrompt

**Objective:** `createSession` 支持 `role` 参数，用于区分主 agent 和 subagent 模式

**Files:**
- Modify: `src/core/agent.ts`

**Step 1: 定义 CreateSessionOptions 接口**

在文件顶部添加：

```typescript
export interface CreateSessionOptions {
  /** Subagent role (ingest/query/lint), undefined for main agent */
  role?: string;
  /** Additional system prompt content to append */
  appendSystemPrompt?: string[];
}
```

**Step 2: 修改 createSession 签名**

```typescript
async createSession(wikiRoot: string, options?: CreateSessionOptions) {
  const { role, appendSystemPrompt: extraPrompts } = options ?? {};
  // ...
}
```

**Step 3: 根据 role 设置 resourceLoaderOptions**

在 `createSession` 内部，**移除**原来的 `additionalSkillPaths` 逻辑（从 `~/.llm-wiki-agent/skills/` 加载），修改为：

```typescript
resourceLoaderOptions: {
  noSkills: true,
  appendSystemPrompt: [
    ...this.systemPromptLines,
    ...(extraPrompts ?? []),
  ],
  ...(role && {
    // Subagent 模式：禁用所有 extension，传入自定义 system prompt
    noExtensions: true,
    systemPrompt: loadSubagentPrompt(role),
  }),
  // Skills 加载在 Task 5 中统一处理
},
```

**Step 4: 添加 loadSubagentPrompt 函数**

在 `WikiAgent` 类外部添加：

```typescript
import { existsSync } from "fs";
import { join } from "path";
import { readFileSync } from "fs";

function loadSubagentPrompt(role: string): string[] {
  const repoRoot = join(__dirname, "../..");  // src/core/ -> 项目根
  const agentsDir = join(repoRoot, "agents");
  const filePath = join(agentsDir, `wiki-${role}.md`);
  try {
    const content = readFileSync(filePath, "utf-8");
    // 解析 frontmatter，body 作为 system prompt
    const { body } = parseFrontmatter(content);
    // 替换 {wikiRoot} 占位符（实际路径由调用方提供，这里只是模板）
    return body.split("\n");
  } catch {
    return [];
  }
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) {
      frontmatter[key.trim()] = rest.join(":").trim();
    }
  }
  return { frontmatter, body: match[2] };
}
```

注意：`parseFrontmatter` 可以从 pi SDK 导入，也可以自己实现。推荐从 SDK 导入：

```typescript
// 如果 pi SDK 导出了 parseFrontmatter，改为：
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";

// 否则使用自己实现的版本（见 wiki-subagent.ts 中的实现）
```

**Step 5: 验证编译**

```bash
cd /Users/hushicai/data/ai-project/llm-wiki-agent
bun build
# 预期：无编译错误
```

**Step 6: Commit**

```bash
git add src/core/agent.ts
git commit -m "feat: WikiAgent.createSession supports role and appendSystemPrompt"
```

---

## Task 4: 创建仓库 extensions/ 目录 + wiki-subagent.ts

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
├── skills/                 # 仓库技能
└── src/core/agent.ts       # 显式加载仓库 extensions/ + skills/
```

**Step 1: 创建 extensions 目录**

```bash
mkdir -p extensions
```

**Step 2: wiki-subagent.ts 放在仓库 extensions/**

代码同上（略），**文件路径改为** `extensions/wiki-subagent.ts`。

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import { type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

// === 发现逻辑（从仓库 agents/ 读取） ===

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) {
      frontmatter[key.trim()] = rest.join(":").trim();
    }
  }
  return { frontmatter, body: match[2] };
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!fs.existsSync(dir)) return agents;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(content);
    if (!frontmatter.name || !frontmatter.description) continue;
    const tools = frontmatter.tools
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

export function discoverAgents(cwd: string, _scope: AgentScope): { agents: AgentConfig[]; projectAgentsDir: string | null } {
  // llm-wiki-agent: 从仓库 agents/ 目录发现（不在 user home）
  const repoRoot = path.join(__dirname, "../..");  // extensions/ -> 项目根
  const agentsDir = path.join(repoRoot, "agents");
  const userAgents = loadAgentsFromDir(agentsDir, "user");
  return { agents: userAgents, projectAgentsDir: null };
}

// === 子进程启动逻辑 ===

function getCliInvocation(wikiRoot: string, args: string[]): { command: string; args: string[] } {
  // 找到 llm-wiki-agent 可执行文件
  // 优先使用 bun run（开发模式）或者编译后的 dist/cli.js
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");

  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    // 如果当前在 dist/cli.js 中运行，直接用它
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  // 否则尝试 bun run src/cli.ts
  const pkgRoot = path.join(__dirname, "../../.."); // src/core/extensions/ -> 项目根
  const cliPath = path.join(pkgRoot, "src/cli.ts");
  if (fs.existsSync(cliPath)) {
    return { command: "bun", args: [cliPath, ...args] };
  }

  // 回退：假设 bun 在 PATH 中
  return { command: "bun", args: ["run", pkgRoot + "/src/cli.ts", ...args] };
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wiki-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

interface SubagentResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  errorMessage?: string;
  stopReason?: string;
}

async function runSingleAgent(
  wikiRoot: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
): Promise<SubagentResult> {
  const agent = agents.find((a) => a.name === agentName);
  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}". Available: ${available}.`,
    };
  }

  // 构建 llm-wiki-agent 命令
  // llm-wiki-agent --wiki <path> --mode json --append-system-prompt <file> <task>
  const args: string[] = [
    "--wiki", wikiRoot,
    "--mode", "json",
  ];

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  if (agent.systemPrompt.trim()) {
    const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
    tmpPromptDir = tmp.dir;
    tmpPromptPath = tmp.filePath;
    args.push("--append-system-prompt", tmpPromptPath);
  }

  args.push(task);

  const currentResult: SubagentResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
  };

  try {
    const invocation = getCliInvocation(wikiRoot, args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: wikiRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      if (event.type === "message_end" && event.message) {
        const msg = event.message as Message;
        currentResult.messages.push(msg);
        if (msg.stopReason) currentResult.stopReason = msg.stopReason;
        if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
        onUpdate?.({
          content: [{ type: "text", text: msg.content?.[0]?.type === "text" ? msg.content[0].text : "" }],
        });
      }
    };

    proc.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    proc.stderr.on("data", (data) => {
      currentResult.stderr += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        resolve(code ?? 0);
      });
      proc.on("error", () => resolve(1));

      if (signal) {
        const killProc = () => {
          proc.kill("SIGTERM");
          setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
        };
        if (signal.aborted) killProc();
        else signal.addEventListener("abort", killProc, { once: true });
      }
    });

    currentResult.exitCode = exitCode;
    return currentResult;
  } finally {
    if (tmpPromptPath) try { fs.unlinkSync(tmpPromptPath); } catch { /* ignore */ }
    if (tmpPromptDir) try { fs.rmdirSync(tmpPromptDir); } catch { /* ignore */ }
  }
}

// === Extension 注册 ===

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Name of the agent to invoke" })),
  task: Type.Optional(Type.String({ description: "Task to delegate" })),
});

export default function wikiSubagentExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Delegate tasks to specialized wiki subagents (wiki-ingest, wiki-query, wiki-lint).",
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const discovery = discoverAgents(ctx.cwd, "user");
      const agents = discovery.agents;

      if (!params.agent || !params.task) {
        const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
        return {
          content: [{ type: "text", text: `Usage: subagent({ agent: "name", task: "..." })\nAvailable: ${available}` }],
        };
      }

      const result = await runSingleAgent(ctx.cwd, agents, params.agent, params.task, signal, onUpdate);

      const isError = result.exitCode !== 0 || result.stopReason === "error";
      if (isError) {
        return {
          content: [{ type: "text", text: result.errorMessage || result.stderr || "Subagent failed" }],
          isError: true,
        };
      }

      // 提取最终文本输出
      let finalText = "";
      for (let i = result.messages.length - 1; i >= 0; i--) {
        const msg = result.messages[i];
        if (msg.role === "assistant") {
          for (const part of msg.content) {
            if (part.type === "text") { finalText = part.text; break; }
          }
          break;
        }
      }

      return { content: [{ type: "text", text: finalText || result.stderr || "(done)" }] };
    },
  });
}
```

**Step 3: Commit**

```bash
mkdir -p extensions
# 创建 extensions/wiki-subagent.ts
git add extensions/
git commit -m "feat: add wiki-subagent extension"
```

---

## Task 5: WikiAgent 显式加载仓库 extensions/skills

**Objective:** 不依赖 SDK 自动发现，通过 `additionalExtensionPaths` / `additionalSkillPaths` 显式传入仓库路径

**Files:**
- Modify: `src/core/agent.ts`

**设计原则：**
- `noExtensions: true` + `noSkills: true` 关闭 SDK 自动发现
- 仓库 `extensions/` 和 `skills/` 全部自己管理
- 通过 `additionalExtensionPaths` / `additionalSkillPaths` 传入

**Step 1: 修改 src/core/agent.ts**

```typescript
import { existsSync } from "fs";
import { join } from "path";

export interface CreateSessionOptions {
  /** Subagent role (ingest/query/lint), undefined for main agent */
  role?: string;
  /** Additional system prompt content to append */
  appendSystemPrompt?: string[];
}

export class WikiAgent {
  // ...

  async createSession(wikiRoot: string, options?: CreateSessionOptions) {
    const { role, appendSystemPrompt: extraPrompts } = options ?? {};

    // 仓库根目录（用于 extensions/ 和 skills/）
    const repoRoot = join(__dirname, "../.."); // src/core/ -> 项目根

    const extensionsDir = join(repoRoot, "extensions");
    const skillsDir = join(repoRoot, "skills");

    const resourceLoaderOptions: any = {
      // 关闭 SDK 自动发现，全部自己管理
      noExtensions: true,
      noSkills: true,

      // 显式传入仓库 extensions/ + skills/
      ...(existsSync(extensionsDir) && {
        additionalExtensionPaths: [extensionsDir],
      }),
      ...(existsSync(skillsDir) && {
        additionalSkillPaths: [skillsDir],
      }),

      // System prompt
      appendSystemPrompt: [
        ...this.systemPromptLines,
        ...(extraPrompts ?? []),
      ],

      // Subagent 模式
      ...(role && {
        noExtensions: true,
        systemPrompt: loadSubagentPrompt(role),
      }),
    };

    // ...
  }
}
```

**Step 2: 验证编译**

```bash
cd /Users/hushicai/data/ai-project/llm-wiki-agent
bun build
# 预期：无编译错误
```

**Step 3: Commit**

```bash
git add src/core/agent.ts
git commit -m "feat: WikiAgent loads extensions/skills from repo paths"
```

---

## Task 6: 测试 Subagent 模式

**Objective:** 验证 `llm-wiki-agent --role query --append-system-prompt <file>` 能正常工作

**Files:**
- 测试用的 wiki 目录

**Step 1: 手动测试 query subagent**

```bash
cd /Users/hushicai/data/ai-project/llm-wiki-agent

# 创建临时测试 wiki
TEST_WIKI=/tmp/test-wiki-subagent
mkdir -p $TEST_WIKI/raw $TEST_WIKI/wiki
echo "# Test Entry\n\nTest content." > $TEST_WIKI/wiki/test.md
echo "title: test\n---" > $TEST_WIKI/wiki/test.md
echo -e "---\nname: test\n---\ntest content" > $TEST_WIKI/wiki/test.md

# 测试 subagent 模式（JSON 模式输出）
echo "What is test?" | bun run src/cli.ts --wiki $TEST_WIKI --mode json --append-system-prompt ./agents/wiki-query.md
# 预期：JSON 行输出，最终有 message_end 事件
```

**Step 2: 验证 JSON 输出格式**

```bash
# 检查是否输出了 JSON 行（每个事件一行）
echo "What is test?" | bun run src/cli.ts --wiki $TEST_WIKI --mode json --append-system-prompt ./agents/wiki-query.md 2>&1 | head -5
# 预期：{"type":"start",...} 或类似 JSON 事件
```

**Step 3: Commit**

```bash
git add -A
git commit -m "test: add subagent integration tests"
```

---

## Task 7: 端到端测试 — 主 Agent 调用 Subagent

**Objective:** 验证主 agent 能通过 `subagent` 工具调用 subagent

**Step 1: 在测试 wiki 上启动主 agent**

```bash
# 模拟主 agent 的 subagent 工具调用
# 验证 discoverAgents 能找到 3 个 subagent
TEST_WIKI=/tmp/test-wiki-subagent

# 测试 wiki-subagent.ts 的 discoverAgents
node --input-type=module << 'EOF'
import { discoverAgents } from './extensions/wiki-subagent.js';
const result = discoverAgents('/tmp/test-wiki-subagent', 'user');
console.log('Found agents:', result.agents.map(a => a.name));
EOF
# 预期：["wiki-ingest", "wiki-query", "wiki-lint"]
```

**Step 2: 端到端分发测试**

```bash
# 手动验证 subagent 工具能正确 spawn 子进程
# 通过 InteractiveMode 模拟（太复杂，可跳过，手动验证）
# 关注点：wiki-subagent.ts 的 getCliInvocation() 能找到正确路径
```

---

## 实施顺序

|| # | Task | 优先级 | 依赖 |
|---|------|--------|------|
| 1 | 创建 subagent 定义文件（`agents/wiki-*.md`） | P0 | 无 |
| 2 | CLI 改造（`--mode json` + `--append-system-prompt`） | P0 | 无 |
| 3 | WikiAgent.createSession 支持 role + appendSystemPrompt | P0 | Task 2 |
| 3.1 | 清理 agent.ts：移除 `~/.llm-wiki-agent/skills/` 加载逻辑 | P0 | Task 3 |
| 4 | 创建仓库 `extensions/wiki-subagent.ts` | P0 | Task 1 |
| 4.1 | 清理 wiki-subagent.ts：移除冗余 import | P0 | Task 4 |
| 5 | WikiAgent 显式加载仓库 `extensions/` + `skills/` | P0 | Task 4, 4.1, 3.1 |
| 6 | 测试 subagent 模式 | P1 | Task 4, 4.1, 5 |
| 7 | 端到端分发测试 | P2 | Task 5 |

**注意：** Task 3.1 和 3 在 `src/core/agent.ts` 中合并实现。Task 4.1 在 Task 4 中一并实现。

## 关键风险点

1. **`__dirname` 回溯路径**：dist/ 下运行 vs 源码运行路径不同，需验证 `join(__dirname, "../..")` 能正确找到仓库根
2. **`parseFrontmatter` 复用**：从 pi SDK 导入 vs 自己实现，确保行为一致
3. **`runPrintMode` 的 `mode: "json"` 输出格式**：需要确认 pi SDK 的 JSON 事件类型与 `processLine` 解析匹配
4. **SDK `additionalExtensionPaths` 加载机制**：确保 SDK 能正确加载仓库 `extensions/` 下的 .js 文件
