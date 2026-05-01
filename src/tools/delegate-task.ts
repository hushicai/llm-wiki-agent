// src/tools/delegate-task.ts — wiki_delegate_task tool
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { BeforeToolCallContext } from "@mariozechner/pi-agent-core";
import { WikiAgent } from "../core/agent.js";
import { createWikiTools } from "./index.js";
import { INGEST_ROLE_PROMPT, QUERY_ROLE_PROMPT, LINT_ROLE_PROMPT } from "../prompts/roles.js";

type AgentName = "ingest" | "query" | "lint";

const ROLE_PROMPTS: Record<AgentName, string> = {
  ingest: INGEST_ROLE_PROMPT,
  query: QUERY_ROLE_PROMPT,
  lint: LINT_ROLE_PROMPT,
};

export function createWikiDelegateTaskTool(wikiRoot: string): ToolDefinition<any> {
  return {
    name: "wiki_delegate_task",
    label: "Wiki Delegate",
    description:
      "Delegate a task to a specialized wiki subagent (ingest/query/lint). " +
      "The subagent inherits the user's original request from the conversation context. " +
      "Choose the appropriate agent type based on the task.",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: ["ingest", "query", "lint"],
          description:
            "Which subagent to delegate to: " +
            "ingest=add content, query=search/retrieve, lint=review/fix quality",
        },
      },
      required: ["agent"],
    },
    async execute(
      _toolCallId,
      params: { agent: AgentName },
      _signal,
      onUpdate,
      _ctx,
    ): Promise<AgentToolResult<any>> {
      const { agent } = params;

      // Extract user message from main agent context
      const ctx = _ctx as BeforeToolCallContext;
      const userMessages = ctx.context.messages.filter((m: any) => m.role === "user");
      const lastUserMessage = userMessages[userMessages.length - 1];

      // Extract text from the message
      let userText = "";
      if (typeof lastUserMessage?.content === "string") {
        userText = lastUserMessage.content;
      } else if (Array.isArray(lastUserMessage?.content)) {
        userText = lastUserMessage.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
      }

      const NEUTRAL_CWD = mkdtempSync(join(tmpdir(), "wiki-subagent-"));
      const subAgent = new WikiAgent();
      const runtime = await subAgent.createSession(NEUTRAL_CWD);
      const session = runtime.session;

      // Subscribe to subagent events BEFORE prompt
      const unsubscribe = session.subscribe((event: any) => {
        if (event.type === "tool_execution_start") {
          const toolName = event.toolName || "unknown";
          const args = event.args || {};
          const argsStr =
            args.command ||
            args.path ||
            args.pattern ||
            args.query ||
            args.search ||
            args.timeout ||
            args.limit ||
            args.cwd ||
            JSON.stringify(args);
          const msg = `[subagent] ⚡ ${toolName} ${argsStr}`.trim();
          console.error(msg);
          onUpdate?.({
            content: [{ type: "text", text: msg }],
            details: { toolName, args: argsStr, isSubagent: true },
          });
        } else if (event.type === "tool_execution_end") {
          const toolName = event.toolName || "unknown";
          const args = event.args || {};
          const argsStr =
            args.command ||
            args.path ||
            args.pattern ||
            args.query ||
            args.search ||
            args.timeout ||
            args.limit ||
            args.cwd ||
            "";
          const msg = argsStr ? `[subagent] ✓ ${toolName} ${argsStr}` : `[subagent] ✓ ${toolName}`;
          console.error(msg);
          onUpdate?.({
            content: [{ type: "text", text: msg }],
            details: { toolName: event.toolName },
          });
        }
      });

      // System: base prompt (from prompts/system-prompt.md)
      // User[0]: role prompt (agent role definition)
      // User[1]: user's original question
      await session.sendUserMessage([{ type: "text", text: ROLE_PROMPTS[agent] }]);
      await session.prompt(userText);

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
