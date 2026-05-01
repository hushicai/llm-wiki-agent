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
      onUpdate,
      _ctx,
    ): Promise<AgentToolResult<any>> {
      const { task } = params;

      const NEUTRAL_CWD = mkdtempSync(join(tmpdir(), "wiki-subagent-"));
      const subAgent = new WikiAgent();
      const runtime = await subAgent.createSession(NEUTRAL_CWD);
      const session = runtime.session;

      // Subscribe to subagent events BEFORE prompt
      const unsubscribe = session.subscribe((event: any) => {
        // Only show tool calls, skip text messages
        if (event.type === "tool_execution_start") {
          const toolName = event.toolName || "unknown";
          const args = event.args || {};
          // Extract common args
          const argsStr = args.command || args.path || args.pattern || args.query || args.search || args.timeout || args.limit || args.cwd || JSON.stringify(args);
          const msg = `[subagent] ⚡ ${toolName} ${argsStr}`.trim();
          console.error(msg);
          onUpdate?.({
            content: [{ type: "text", text: msg }],
            details: { toolName, args: argsStr, isSubagent: true },
          });
        } else if (event.type === "tool_execution_end") {
          const toolName = event.toolName || "unknown";
          const args = event.args || {};
          const argsStr = args.command || args.path || args.pattern || args.query || args.search || args.timeout || args.limit || args.cwd || "";
          const msg = argsStr ? `[subagent] ✓ ${toolName} ${argsStr}` : `[subagent] ✓ ${toolName}`;
          console.error(msg);
          onUpdate?.({
            content: [{ type: "text", text: msg }],
            details: { toolName: event.toolName },
          });
        }
      });

      await session.prompt(task);

      // Wait briefly for final events
      await new Promise((r) => setTimeout(r, 300));
      unsubscribe();

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
        details: undefined,
      };
    },
  };
}
