// src/server/session.ts — Web session manager for llm-wiki-agent
// Manages multiple concurrent agent sessions with auto-cleanup.
import type { WikiAgent } from "../core/agent.js";
import { createWikiDelegateTaskTool } from "../tools/delegate-task.js";
import { MAIN_ROLE_PROMPT } from "../prompts/index.js";

interface SessionEntry {
  runtime: any; // AgentSessionRuntime
  createdAt: number;
  lastActivity: number;
}

export class WebSessionManager {
  private sessions = new Map<string, SessionEntry>();
  private cleanupTimer: Timer | null = null;
  private readonly TTL_MS = 30 * 60 * 1000; // 30 min

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  async create(
    agent: WikiAgent,
    wikiRoot: string,
  ): Promise<{ id: string; runtime: any }> {
    const id = crypto.randomUUID();
    const runtime = await agent.createSession(wikiRoot, {
      tools: [createWikiDelegateTaskTool(wikiRoot)],
      appendSystemPrompt: [MAIN_ROLE_PROMPT],
    });
    const now = Date.now();
    this.sessions.set(id, { runtime, createdAt: now, lastActivity: now });
    return { id, runtime };
  }

  get(id: string): any | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    entry.lastActivity = Date.now();
    return entry.runtime;
  }

  async remove(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (entry) {
      try {
        await entry.runtime.dispose();
      } catch {
        // ignore dispose errors
      }
      this.sessions.delete(id);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastActivity > this.TTL_MS) {
        entry.runtime.dispose().catch(() => {});
        this.sessions.delete(id);
      }
    }
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const [, entry] of this.sessions) {
      entry.runtime.dispose().catch(() => {});
    }
    this.sessions.clear();
  }
}
