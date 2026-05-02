// extensions/wiki-subagent.ts
// Wiki subagent extension: registers 'subagent' tool to delegate tasks to wiki subagents.
// Subagents: wiki-ingest, wiki-query, wiki-lint
// Agent definitions are loaded from ./agents/ (仓库 agents/ 目录)
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
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

// === Agent discovery (从仓库 agents/ 读取) ===

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

function getRepoRoot(): string {
  if (typeof __dirname !== "undefined") {
    return path.join(__dirname, "../..");
  }
  // Bun runtime: use import.meta.url
  const currentFile = import.meta.url;
  return path.join(path.dirname(currentFile.replace("file://", "")), "../..");
}

// === Agent discovery (从仓库 agents/ 读取) ===

export function discoverAgents(cwd: string, _scope: AgentScope): { agents: AgentConfig[]; projectAgentsDir: string | null } {
  // llm-wiki-agent: 从仓库 agents/ 目录发现（不在 user home）
  const repoRoot = getRepoRoot();
  const agentsDir = path.join(repoRoot, "agents");
  const userAgents = loadAgentsFromDir(agentsDir, "user");
  return { agents: userAgents, projectAgentsDir: null };
}

// === CLI invocation ===

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
  const pkgRoot = getRepoRoot();
  const cliPath = path.join(pkgRoot, "src/cli.ts");
  if (fs.existsSync(cliPath)) {
    return { command: "bun", args: [cliPath, ...args] };
  }

  // 回退：假设 bun 在 PATH 中
  return { command: "bun", args: ["run", pkgRoot + "/src/cli.ts", ...args] };
}

// === Subagent execution ===

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

// === Extension registration ===

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
