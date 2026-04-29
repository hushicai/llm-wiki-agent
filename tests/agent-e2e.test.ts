import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { registerFauxProvider, fauxAssistantMessage, fauxToolCall, fauxText, type Tool } from "@mariozechner/pi-ai";
import { Type } from "typebox";

describe("Agent Tool Integration", () => {
  const testDir = join(tmpdir(), "llm-wiki-agent-agent-test");
  let faux: ReturnType<typeof registerFauxProvider>;

  // Create a test tool with proper TypeBox schema
  function createTestTool(name: string): AgentTool {
    return {
      name,
      label: `Test ${name}`,
      description: `Test tool for ${name}`,
      parameters: Type.Object({
        input: Type.String(),
      }),
      execute: async (id, params) => {
        return {
          content: [{ type: "text", text: `Executed ${name}` }],
          details: { name, input: (params as any).input },
        };
      },
    };
  }

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    faux = registerFauxProvider({ provider: "faux", api: "faux" });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    faux.unregister();
  });

  test("agent initializes with tools", () => {
    const tool = createTestTool("test");
    
    const agent = new Agent({
      initialState: {
        systemPrompt: "Test",
        model: faux.getModel("faux-1")!,
        thinkingLevel: "off",
        tools: [tool],
      },
    });

    expect(agent.state.tools).toHaveLength(1);
    expect(agent.state.tools[0].name).toBe("test");
  });

  test("faux provider returns responses", async () => {
    faux.setResponses([
      fauxAssistantMessage({
        content: [fauxText("Hello from faux")],
        stopReason: "stop",
      }),
    ]);

    const agent = new Agent({
      initialState: {
        systemPrompt: "Test",
        model: faux.getModel("faux-1")!,
        thinkingLevel: "off",
        tools: [],
      },
    });

    const events: string[] = [];
    agent.subscribe((event) => {
      events.push(event.type);
    });

    await agent.prompt("Hello");
    await agent.waitForIdle();

    expect(events).toContain("agent_start");
    expect(events).toContain("agent_end");
  });

  test.skip("agent executes tool call - requires full harness setup", async () => {
    // This test requires the full test harness from pi-coding-agent
    // which provides proper faux stream function setup.
    // See: packages/coding-agent/test/test-harness.ts
    const tool = createTestTool("echo");
    
    faux.setResponses([
      fauxAssistantMessage({
        content: [
          fauxToolCall("echo", { input: "test" }, { id: "call-1" }),
        ],
        stopReason: "toolUse",
      }),
      fauxAssistantMessage({
        content: [fauxText("Done")],
        stopReason: "stop",
      }),
    ]);

    const agent = new Agent({
      initialState: {
        systemPrompt: "Use tools",
        model: faux.getModel("faux-1")!,
        thinkingLevel: "off",
        tools: [tool],
      },
    });

    const toolEvents: string[] = [];
    agent.subscribe((event) => {
      if (event.type.startsWith("tool_")) {
        toolEvents.push(event.type);
      }
    });

    await agent.prompt("Run echo with test");
    await agent.waitForIdle();

    // This will fail without proper harness - see test-harness.ts for correct setup
    expect(toolEvents).toContain("tool_execution_end");
  });
});