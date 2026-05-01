// src/tools/delegate-task.ts — wiki_delegate_task tool
import type { ToolDefinition, Theme } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Text } from "@mariozechner/pi-tui";
import { WikiAgent } from "../core/agent.js";
import { INGEST_ROLE_PROMPT, QUERY_ROLE_PROMPT, LINT_ROLE_PROMPT } from "../prompts/index.js";

type AgentName = "ingest" | "query" | "lint";

const ROLE_PROMPTS: Record<AgentName, string> = {
  ingest: INGEST_ROLE_PROMPT,
  query: QUERY_ROLE_PROMPT,
  lint: LINT_ROLE_PROMPT,
};

export function createWikiDelegateTaskTool(
  wikiRoot: string,
  options?: { mockMode?: boolean },
): ToolDefinition<any> {

  return {
    name: "wiki_delegate_task",
    label: "Wiki Delegate",
    description:
      "Delegate a task to a specialized wiki subagent (ingest/query/lint). " +
      "Pass the user's full request in the 'task' parameter so the subagent knows what to do.",
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
        task: {
          type: "string",
          description:
            "REQUIRED. The full task description for the subagent. " +
            "Combine the user's intent with conversation context to form a complete, actionable task. " +
            "Example: if user says '如何开户', pass '用户问开户需要什么资料和流程，请搜索 wiki 中关于开户的所有内容并综合回答'.",
        },
      },
      required: ["agent", "task"],
    },
    renderCall(args: { agent: string; task: string }, theme: Theme) {
      const text =
        theme.fg("toolTitle", theme.bold("wiki_delegate_task")) +
        " " +
        theme.fg("muted", JSON.stringify(args));
      return new Text(text, 0, 0);
    },
    async execute(
      _toolCallId,
      params: { agent: AgentName; task: string },
      _signal,
      onUpdate,
      _ctx,
    ): Promise<AgentToolResult<any>> {
      const { agent, task } = params;
      const userText = task.trim();

      // REAL mode: spin up subagent
      const subAgent = new WikiAgent();
      const runtime = await subAgent.createSession(wikiRoot, {
        tools: undefined,
      });
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
          onUpdate?.({
            content: [{ type: "text", text: msg }],
            details: undefined,
          });
        } else if (event.type === "tool_execution_end") {
          // const toolName = event.toolName || "unknown";
          // const args = event.args || {};
          // const argsStr =
          //   args.command ||
          //   args.path ||
          //   args.pattern ||
          //   args.query ||
          //   args.search ||
          //   args.timeout ||
          //   args.limit ||
          //   args.cwd ||
          //   "";
          // // const msg = argsStr ? `[subagent] ✓ ${toolName} ${argsStr}` : `[subagent] ✓ ${toolName}`;
          // const msg = `[subagent] ✓ ${toolName} ${argsStr}`.trim();

          // onUpdate?.({
          //   content: [{ type: "text", text: msg }],
          //   details: undefined,
          // });
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
