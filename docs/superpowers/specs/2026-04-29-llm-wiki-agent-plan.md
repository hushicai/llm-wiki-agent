# llm-wiki-agent v1 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rewrite llm-wiki-agent from pi-agent-core to pi-coding-agent SDK, keeping the 6 wiki tools and adding CLI/TUI modes.

**Architecture:** Replace the current hand-rolled Agent/REPL/session stack with pi-coding-agent's `createAgentSession()`, `runPrintMode()`, and `InteractiveMode`. Disable all built-in coding tools (`noTools: "all"`), register wiki tools as `customTools`. Config directory `~/.llm-wiki-agent/` is independent from `~/.pi/agent/`.

**Tech Stack:** `@mariozechner/pi-coding-agent ^0.70.5`, `@mariozechner/pi-ai ^0.70.5`, bun runtime

**Project root:** `/Users/hushicai/data/ai-project/llm-wiki-agent/`

---

### Task 1: Update dependencies and project structure

**Objective:** Switch from pi-agent-core to pi-coding-agent, remove unused files

**Files:**
- Modify: `package.json`
- Delete: `src/agents.ts`, `src/session.ts`, `src/tui.ts`
- Create: `src/types.ts` (keep existing, already has ToolDefinition-compatible schemas)

**Step 1: Update package.json**

Replace `@mariozechner/pi-agent-core` with `@mariozechner/pi-coding-agent`:

```json
{
  "dependencies": {
    "@mariozechner/pi-coding-agent": "^0.70.5",
    "@mariozechner/pi-ai": "^0.70.5",
    "typebox": "^1.1.24",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.5.0"
  }
}
```

Remove `pino` and `gray-matter` (not used in v1).

**Step 2: Delete unused files**

```bash
rm src/agents.ts src/session.ts src/tui.ts
```

**Step 3: Install dependencies**

```bash
cd /Users/hushicai/data/ai-project/llm-wiki-agent
rm -rf node_modules
bun install
```

Expected: no errors, `@mariozechner/pi-coding-agent` resolves.

---

### Task 2: Rewrite config.ts — use pi-coding-agent's ModelRegistry + SettingsManager

**Objective:** Replace the hand-rolled config loader with pi-coding-agent's infrastructure

**Files:**
- Modify: `src/config.ts`

**Step 1: Rewrite config.ts**

```typescript
import { join } from "path";
import { homedir } from "os";

export const AGENT_DIR = join(homedir(), ".llm-wiki-agent");

export function getAgentDir(): string {
  return AGENT_DIR;
}

export function getSessionDir(wikiSlug: string): string {
  return join(AGENT_DIR, "sessions", wikiSlug);
}

export function getModelsPath(): string {
  return join(AGENT_DIR, "models.json");
}

export function getAuthPath(): string {
  return join(AGENT_DIR, "auth.json");
}

export function getSettingsPath(): string {
  return join(AGENT_DIR, "settings.json");
}

export function slugify(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}
```

**Step 2: Verify**

```bash
bun run src/cli.ts --help
```

Expected: compiles and shows help (even if other parts fail).

---

### Task 3: Rewrite runtime.ts — use createAgentSession()

**Objective:** Replace the hand-rolled Agent wrapper with pi-coding-agent's SDK

**Files:**
- Modify: `src/runtime.ts`

**Step 1: Rewrite runtime.ts**

```typescript
import { createAgentSession, SessionManager, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { createWikiTools } from "./tools/index.js";
import { getAgentDir, getSessionDir, slugify } from "./config.js";

export interface WikiSessionOptions {
  wikiRoot: string;
  modelId?: string;
  provider?: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
}

export async function createWikiSession(options: WikiSessionOptions) {
  const { wikiRoot, thinkingLevel = "medium" } = options;
  const wikiSlug = slugify(wikiRoot.split("/").pop() || "wiki");
  const agentDir = getAgentDir();
  const sessionDir = getSessionDir(wikiSlug);

  const sessionManager = SessionManager.create(wikiRoot, sessionDir);
  const wikiTools = createWikiTools({ wikiRoot });

  const { session } = await createAgentSession({
    agentDir,
    noTools: "all",
    customTools: wikiTools as ToolDefinition[],
    thinkingLevel,
    sessionManager,
  });

  return session;
}
```

**Step 2: Verify compilation**

```bash
bun build src/runtime.ts --outdir dist
```

Expected: compiles without errors.

---

### Task 4: Rewrite tools — convert from AgentTool to ToolDefinition

**Objective:** All 6 wiki tools must use pi-coding-agent's `ToolDefinition` signature instead of pi-agent-core's `AgentTool`

**Files:**
- Modify: `src/tools/wiki-read.ts`
- Modify: `src/tools/wiki-write.ts`
- Modify: `src/tools/wiki-search.ts`
- Modify: `src/tools/wiki-list.ts`
- Modify: `src/tools/wiki-ingest.ts`
- Modify: `src/tools/wiki-lint.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/types.ts` (update schemas)

**Step 1: Update types.ts — add ToolDefinition-compatible parameter schemas**

The existing TypeBox schemas are compatible with pi-coding-agent's `parameters` field. Keep them, but ensure `ToolDefinition` is imported from the right place.

**Step 2: Rewrite wiki-read.ts**

Key change: import `ToolDefinition` from pi-coding-agent, use its execute signature:

```typescript
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { WikiReadParams } from "../types.js";

export function createWikiReadTool(wikiRoot: string): ToolDefinition {
  return {
    name: "wiki_read",
    label: "Read Wiki Page",
    description: "Read a wiki page or raw source.",
    parameters: WikiReadParams,
    execute: async (toolCallId: string, params: any, onUpdate?: any, ctx?: any, signal?: AbortSignal) => {
      const baseDir = params.mode === "raw" ? join(wikiRoot, "raw") : join(wikiRoot, "wiki");
      const fullPath = join(baseDir, params.path);

      if (!existsSync(fullPath)) {
        return { content: [{ type: "text", text: `Error: File not found: ${params.path}` }] };
      }

      const content = await readFile(fullPath, "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, (params.offset || 1) - 1);
      const end = Math.min(lines.length, start + (params.limit || 500));
      return { content: [{ type: "text", text: lines.slice(start, end).join("\n") }] };
    },
  };
}
```

**Step 3-7: Repeat for all 6 tools** — same pattern: `AgentTool` → `ToolDefinition`, update import and execute signature.

**Step 8: Update tools/index.ts**

```typescript
import { createWikiReadTool } from "./wiki-read.js";
import { createWikiWriteTool } from "./wiki-write.js";
import { createWikiSearchTool } from "./wiki-search.js";
import { createWikiListTool } from "./wiki-list.js";
import { createWikiIngestTool } from "./wiki-ingest.js";
import { createWikiLintTool } from "./wiki-lint.js";

export function createWikiTools(opts: { wikiRoot: string }) {
  return [
    createWikiReadTool(opts.wikiRoot),
    createWikiWriteTool(opts.wikiRoot),
    createWikiSearchTool(opts.wikiRoot),
    createWikiListTool(opts.wikiRoot),
    createWikiIngestTool(opts.wikiRoot),
    createWikiLintTool(opts.wikiRoot),
  ];
}
```

Note: removed `version` parameter (v1 only).

**Step 9: Verify all tools compile**

```bash
bun build src/tools/index.ts --outdir dist
```

Expected: no errors.

---

### Task 5: Rewrite CLI entry point — add PrintMode and InteractiveMode

**Objective:** Replace the current CLI with pi-coding-agent's runPrintMode and InteractiveMode

**Files:**
- Modify: `src/cli.ts`

**Step 1: Rewrite cli.ts**

```typescript
#!/usr/bin/env bun
import { runPrintMode, InteractiveMode } from "@mariozechner/pi-coding-agent";
import { createWikiSession } from "./runtime.js";
import { initWiki, isWikiInitialized, loadWikiConfig } from "./init.js";
import { existsSync } from "fs";

function printHelp(): void {
  console.log(`
llm-wiki-agent — Wiki Knowledge Agent CLI

Usage:
  wiki --wiki <path> [query]    Run query or start interactive mode
  wiki --wiki <path> --init     Initialize wiki
  wiki --version                Show version
  wiki --help                   Show this help

Options:
  --wiki, -w <path>     Wiki root directory (required)
  --init, -i            Initialize wiki if not exists
  --model <id>          Model to use (e.g. "openai/gpt-4o")
  --version             Show version
  --help                Show this help
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--version")) {
    console.log("llm-wiki-agent v0.1.0");
    return;
  }

  const wikiIndex = args.indexOf("--wiki");
  const wikiShortIndex = args.indexOf("-w");
  const wikiRoot = wikiIndex !== -1 ? args[wikiIndex + 1] : wikiShortIndex !== -1 ? args[wikiShortIndex + 1] : undefined;

  if (!wikiRoot) {
    console.error("Error: --wiki is required");
    printHelp();
    process.exit(1);
  }

  // Handle --init
  if (args.includes("--init") || args.includes("-i")) {
    if (!existsSync(wikiRoot)) {
      await initWiki(wikiRoot);
      console.log(`Wiki initialized at: ${wikiRoot}`);
    } else if (!(await isWikiInitialized(wikiRoot))) {
      await initWiki(wikiRoot);
      console.log(`Wiki initialized at: ${wikiRoot}`);
    } else {
      console.log(`Wiki already initialized at: ${wikiRoot}`);
    }
    return;
  }

  // Ensure wiki is initialized
  if (!existsSync(wikiRoot) || !(await isWikiInitialized(wikiRoot))) {
    console.error(`Error: Wiki not found or not initialized at: ${wikiRoot}`);
    console.error("Use --init to create one.");
    process.exit(1);
  }

  // Extract query from remaining args (positional after options)
  const query = args.filter(a => !a.startsWith("-") && a !== wikiRoot).join(" ");

  const session = await createWikiSession({ wikiRoot });

  if (query) {
    // PrintMode: single query
    await runPrintMode(session, query);
  } else {
    // InteractiveMode: TUI
    const mode = new InteractiveMode(session);
    await mode.run();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

**Step 2: Verify**

```bash
bun run src/cli.ts --help
```

Expected: shows help text.

---

### Task 6: Update init.ts — align wiki directory structure with design doc

**Objective:** Update wiki initialization to match the design spec structure

**Files:**
- Modify: `src/init.ts`

**Step 1: Update directory structure**

Change from current (`.wiki/` hidden dir + `wiki/` pages) to flat structure per design doc:

```
<wiki-root>/
├── index.md
├── log.md
├── raw/
├── skills/
├── entities/
├── concepts/
└── pages/
```

**Step 2: Update .wikiconfig.yaml format** — simplify for v1, remove v2 fields.

**Step 3: Verify**

```bash
bun run src/cli.ts --wiki /tmp/test-wiki --init
ls /tmp/test-wiki/
```

Expected: directory structure created.

---

### Task 7: End-to-end verification

**Objective:** Verify the full flow works

**Files:**
- Test: `tests/e2e.test.ts`

**Step 1: Write a basic e2e test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { initWiki } from "../src/init.js";
import { createWikiSession } from "../src/runtime.js";

const TEST_WIKI = "/tmp/wiki-test-e2e";

describe("llm-wiki-agent e2e", () => {
  beforeAll(async () => {
    await rm(TEST_WIKI, { recursive: true, force: true });
    await initWiki(TEST_WIKI, { name: "Test Wiki" });
  });

  afterAll(async () => {
    await rm(TEST_WIKI, { recursive: true, force: true });
  });

  it("should initialize a wiki", async () => {
    const { existsSync } = await import("fs");
    expect(existsSync(join(TEST_WIKI, "index.md"))).toBe(true);
    expect(existsSync(join(TEST_WIKI, "log.md"))).toBe(true);
    expect(existsSync(join(TEST_WIKI, "raw"))).toBe(true);
  });

  it("should create a wiki session", async () => {
    const session = await createWikiSession({ wikiRoot: TEST_WIKI });
    expect(session).toBeDefined();
    expect(session.state).toBeDefined();
  });
});
```

**Step 2: Run tests**

```bash
bun test tests/e2e.test.ts
```

Expected: tests pass.

---

### Task 8: Cleanup and final verification

**Objective:** Remove any remaining dead code, ensure clean build

**Files:**
- Modify: `tsconfig.json` (if needed)
- Delete: `dist/` (rebuild)

**Step 1: Clean build artifacts**

```bash
rm -rf dist/
bun run src/cli.ts --help
```

**Step 2: Verify no remaining references to pi-agent-core or pi-ai directly**

```bash
grep -r "pi-agent-core" src/ --include="*.ts" || echo "No direct pi-agent-core imports"
```

Expected: only pi-coding-agent imports remain.

**Step 3: Final check**

```bash
bun run src/cli.ts --version
```

Expected: prints version.
