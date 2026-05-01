// src/tools/delegate-task.ts — wiki_delegate_task tool
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { WikiAgent } from "../core/agent.js";

export function createWikiDelegateTaskTool(wikiRoot: string): ToolDefinition<any> {
  return {
    name: "wiki_delegate_task",
    label: "Wiki Delegate",
    description:
      "Delegate a task to a fresh WikiAgent session with isolated context. " +
      "Use this for wiki searches, content analysis, or any task that should not pollute the main conversation context. " +
      "The sub-agent has full access to wiki tools and skills. " +
      "IMPORTANT: Include the wiki root path at the start of the task: 'Wiki root: /path/to/wiki\\n<your task>'",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "The task to delegate. MUST include wiki root path at the start: " +
            "'Wiki root: /path/to/wiki\\nSearch for: ...' or 'Wiki root: /path/to/wiki\\nYour instruction here'",
        },
      },
      required: ["task"],
    },
    async execute(
      _toolCallId,
      params: { task: string },
      _signal,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<any>> {
      const { task } = params;

      // Use a unique temp dir so subagent won't read AGENTS.md from wiki dir
      const NEUTRAL_CWD = mkdtempSync(join(tmpdir(), "wiki-subagent-"));
      const subAgent = new WikiAgent();
      const runtime = await subAgent.createSession(NEUTRAL_CWD);
      const session = runtime.session;

      await session.prompt(task);
      await new Promise((r) => setTimeout(r, 500));

      // Extract final output
      const outputs: string[] = [];
      for (const msg of session.state.messages) {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") {
              outputs.push(part.text);
            }
          }
        }
      }

      await runtime.dispose();
      await subAgent.dispose();

      const output = outputs.join("\n");
      return {
        content: [{ type: "text", text: output || "(no output)" }],
      };
    },
  };
}
