// src/tools/subagent.ts
// Subagent tool: delegates tasks to wiki subagents (wiki-ingest, wiki-query, wiki-lint).
// Agent definitions loaded from repo agents/ directory.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { Static } from "typebox";
import { Type } from "typebox";
import {
  logSubagentStart,
  logSubagentEnd,
  logSubagentError,
} from "../utils/log.js";
import { getRepoRoot } from "../utils/resolve.js";
import { parseFrontmatter } from "../utils/frontmatter.js";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  filePath: string;
}

// === Agent discovery (从仓库 agents/ 读取) ===

/** @internal exported for testing */
export function loadAgentsFromDir(dir: string): AgentConfig[] {
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
    const fm = frontmatter as Record<string, string>;
    if (!fm.name || !fm.description) continue;
    const tools = fm.tools
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);
    agents.push({
      name: fm.name,
      description: fm.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: fm.model,
      systemPrompt: body,
      filePath,
    });
  }
  return agents;
}

// === Agent discovery ===

export function discoverAgents(_cwd: string): { agents: AgentConfig[]; projectAgentsDir: string | null } {
  const repoRoot = getRepoRoot();
  const agentsDir = path.join(repoRoot, "agents");
  const projectAgents = loadAgentsFromDir(agentsDir);
  return { agents: projectAgents, projectAgentsDir: null };
}

// === CLI invocation ===

/** @internal exported for testing */
export function agentNameToRole(name: string): string {
  // "wiki-ingest" → "ingest", keep as-is if no "wiki-" prefix
  return name.startsWith("wiki-") ? name.slice(5) : name;
}

function getCliInvocation(wikiRoot: string, args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");

  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const pkgRoot = getRepoRoot();
  const cliPath = path.join(pkgRoot, "src/cli.ts");
  if (fs.existsSync(cliPath)) {
    return { command: "bun", args: [cliPath, ...args] };
  }

  return { command: "bun", args: ["run", pkgRoot + "/src/cli.ts", ...args] };
}

// === Subagent execution ===

interface SubagentResult {
  agent: string;
  task: string;
  exitCode: number;
  messages: AssistantMessage[];
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
    const errMsg = `Unknown agent: "${agentName}". Available: ${available}.`;
    logSubagentError(agentName, task, errMsg, 1, "", 0);
    return {
      agent: agentName,
      task,
      exitCode: 1,
      messages: [],
      stderr: errMsg,
    };
  }

  const startTime = Date.now();
  logSubagentStart(agent.name, task);

  const args: string[] = [
    "--wiki", wikiRoot,
    "--mode", "json",
  ];

  // Pass role to load agent prompt + prevent subagent tool registration
  const role = agentNameToRole(agent.name);
  args.push("--role", role);

  // Restrict tools based on agent definition
  if (agent.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  args.push(task);

  const currentResult: SubagentResult = {
    agent: agentName,
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
        const msg = event.message as AssistantMessage;
        currentResult.messages.push(msg);
        if (msg.stopReason) currentResult.stopReason = msg.stopReason;
        if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
        const textContent = Array.isArray(msg.content)
          ? msg.content.find((c): c is { type: "text"; text: string } => typeof c === "object" && "type" in c && c.type === "text")?.text ?? ""
          : "";
        onUpdate?.({
          content: [{ type: "text", text: textContent }],
          details: undefined,
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

    const duration = Date.now() - startTime;
    if (exitCode !== 0 || currentResult.stopReason === "error" || currentResult.errorMessage) {
      logSubagentError(
        agent.name, task,
        currentResult.errorMessage || "",
        exitCode, currentResult.stderr, duration,
      );
    } else {
      logSubagentEnd(
        agent.name, task,
        exitCode, currentResult.messages.length, duration,
      );
    }

    return currentResult;
  } finally {
    // No temp file cleanup needed — role-based agent loads prompt directly from repo
  }
}

// === Tool definition factory ===

export function createSubagentTool(wikiRoot: string): ToolDefinition {
  const SubagentParams = Type.Object({
    agent: Type.Optional(Type.String({ description: "Name of the agent to invoke" })),
    task: Type.Optional(Type.String({ description: "Task to delegate" })),
  });

  return {
    name: "subagent",
    label: "Subagent",
    description: "Delegate tasks to specialized wiki subagents (wiki-ingest, wiki-query, wiki-lint).",
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const p = params as Static<typeof SubagentParams>;
      const discovery = discoverAgents(wikiRoot);
      const agents = discovery.agents;

      if (!p.agent || !p.task) {
        const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
        return {
          content: [{ type: "text", text: `Usage: subagent({ agent: "name", task: "..." })\nAvailable: ${available}` }],
          details: undefined,
        };
      }

      const result = await runSingleAgent(wikiRoot, agents, p.agent, p.task, signal, onUpdate);

      const isError = result.exitCode !== 0 || result.stopReason === "error";
      if (isError) {
        return {
          content: [{ type: "text", text: result.errorMessage || result.stderr || "Subagent failed" }],
          isError: true,
          details: undefined,
        } as AgentToolResult<unknown> & { isError: boolean };
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

      return { content: [{ type: "text", text: finalText || result.stderr || "(done)" }], details: undefined };
    },
  };
}
