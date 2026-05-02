// src/utils/log.ts
// 持久化工具日志：写入 ~/.llm-wiki-agent/agent/tool.log
// 格式：JSON Lines，每行一个结构化事件
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "../core/config.js";

const LOG_FILE = path.join(getAgentDir(), "tool.log");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB rotate

export interface ToolLogEntry {
  ts: string;           // ISO 8601
  event: string;        // "subagent_start" | "subagent_end" | "subagent_error" | "tool_call"
  agent?: string;
  agentSource?: string;
  task?: string;        // truncated to 200 chars
  exitCode?: number;
  messageCount?: number;
  durationMs?: number;
  errorMessage?: string;
  stderrSummary?: string;
  toolName?: string;
  detail?: string;
}

function ensureDir(): boolean {
  const dir = path.dirname(LOG_FILE);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
    return true;
  } catch {
    return false;
  }
}

function rotateIfNeeded(): void {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > MAX_LOG_SIZE) {
        const rotated = LOG_FILE + ".1";
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(LOG_FILE, rotated);
      }
    }
  } catch {
    // rotate failures are non-blocking
  }
}

function truncate(s: string | undefined, maxLen: number): string | undefined {
  if (!s) return s;
  const cleaned = s.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + "...";
}

export function writeToolLog(entry: ToolLogEntry): void {
  try {
    if (!ensureDir()) return;
    rotateIfNeeded();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(LOG_FILE, line, { encoding: "utf-8", mode: 0o644 });
  } catch {
    // log failure never throws
  }
}

// Convenience: subagent lifecycle events
export function logSubagentStart(
  agentName: string,
  task: string,
): void {
  writeToolLog({
    ts: new Date().toISOString(),
    event: "subagent_start",
    agent: agentName,
    task: truncate(task, 200),
  });
}

export function logSubagentEnd(
  agentName: string,
  task: string,
  exitCode: number,
  messageCount: number,
  durationMs: number,
): void {
  writeToolLog({
    ts: new Date().toISOString(),
    event: "subagent_end",
    agent: agentName,
    task: truncate(task, 200),
    exitCode,
    messageCount,
    durationMs,
  });
}

export function logSubagentError(
  agentName: string,
  task: string,
  errorMessage: string,
  exitCode: number,
  stderr: string,
  durationMs: number,
): void {
  writeToolLog({
    ts: new Date().toISOString(),
    event: "subagent_error",
    agent: agentName,
    task: truncate(task, 200),
    errorMessage: truncate(errorMessage, 500),
    exitCode,
    stderrSummary: truncate(stderr, 500),
    durationMs,
  });
}
