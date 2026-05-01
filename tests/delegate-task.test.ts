// Tests for wiki_delegate_task tool
import { describe, expect, test } from "bun:test";
import { createWikiDelegateTaskTool } from "../src/tools/delegate-task.js";

describe("createWikiDelegateTaskTool", () => {
  const wikiRoot = "/tmp/test-wiki";
  const tool = createWikiDelegateTaskTool(wikiRoot);

  test("name is wiki_delegate_task", () => {
    expect(tool.name).toBe("wiki_delegate_task");
  });

  test("label is Wiki Delegate", () => {
    expect(tool.label).toBe("Wiki Delegate");
  });

  test("description is non-empty string", () => {
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(10);
  });

  test("parameters has agent field as required string enum", () => {
    const params = tool.parameters as any;
    expect(params.type).toBe("object");
    expect(params.properties.agent.type).toBe("string");
    expect(params.properties.agent.enum).toEqual(["ingest", "query", "lint"]);
    expect(params.required).toContain("agent");
    expect(params.required.length).toBe(1);
  });

  test("execute is a function", () => {
    expect(typeof tool.execute).toBe("function");
  });

  test("execute has 5 parameters (toolCallId, params, signal, onUpdate, ctx)", () => {
    expect(tool.execute.length).toBeGreaterThanOrEqual(5);
  });

  test(
    "execute creates subagent, calls LLM, returns text output",
    async () => {
      const ac = new AbortController();
      const ctx = {
        context: { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      } as any;

      const result = await tool.execute(
        "test-id",
        { agent: "query" },
        ac.signal,
        undefined,
        ctx,
      );

      // Must return AgentToolResult structure
      expect(result).toHaveProperty("content");
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]).toHaveProperty("type", "text");
      expect(typeof result.content[0].text).toBe("string");
      expect(result).toHaveProperty("details");
    },
    { timeout: 30000 },
  );

  test(
    "execute handles empty subagent output gracefully",
    async () => {
      const ac = new AbortController();
      const ctx = {
        context: { messages: [{ role: "user", content: [{ type: "text", text: "?" }] }] },
      } as any;

      // Use ingest agent with minimal context
      const result = await tool.execute(
        "test-id-3",
        { agent: "ingest" },
        ac.signal,
        undefined,
        ctx,
      );

      // Should always return a result object
      expect(result).toBeDefined();
      expect(result).toHaveProperty("content");
      expect(Array.isArray(result.content)).toBe(true);
    },
    { timeout: 30000 },
  );
});

describe("ROLE_PROMPTS", () => {
  test("INGEST_ROLE_PROMPT is defined and non-empty", async () => {
    const { INGEST_ROLE_PROMPT } = await import("../src/prompts/index.js");
    expect(typeof INGEST_ROLE_PROMPT).toBe("string");
    expect(INGEST_ROLE_PROMPT.length).toBeGreaterThan(10);
  });

  test("QUERY_ROLE_PROMPT is defined and non-empty", async () => {
    const { QUERY_ROLE_PROMPT } = await import("../src/prompts/index.js");
    expect(typeof QUERY_ROLE_PROMPT).toBe("string");
    expect(QUERY_ROLE_PROMPT.length).toBeGreaterThan(10);
  });

  test("LINT_ROLE_PROMPT is defined and non-empty", async () => {
    const { LINT_ROLE_PROMPT } = await import("../src/prompts/index.js");
    expect(typeof LINT_ROLE_PROMPT).toBe("string");
    expect(LINT_ROLE_PROMPT.length).toBeGreaterThan(10);
  });

  test("MAIN_ROLE_PROMPT is defined and non-empty", async () => {
    const { MAIN_ROLE_PROMPT } = await import("../src/prompts/index.js");
    expect(typeof MAIN_ROLE_PROMPT).toBe("string");
    expect(MAIN_ROLE_PROMPT.length).toBeGreaterThan(10);
  });

  test("all role prompts are distinct", async () => {
    const { INGEST_ROLE_PROMPT, QUERY_ROLE_PROMPT, LINT_ROLE_PROMPT, MAIN_ROLE_PROMPT } =
      await import("../src/prompts/index.js");
    const set = new Set([INGEST_ROLE_PROMPT, QUERY_ROLE_PROMPT, LINT_ROLE_PROMPT, MAIN_ROLE_PROMPT]);
    expect(set.size).toBe(4);
  });

  test("role prompts mention their respective agent names", async () => {
    const { INGEST_ROLE_PROMPT, QUERY_ROLE_PROMPT, LINT_ROLE_PROMPT, MAIN_ROLE_PROMPT } =
      await import("../src/prompts/index.js");
    expect(INGEST_ROLE_PROMPT).toContain("录入");
    expect(QUERY_ROLE_PROMPT).toContain("查询");
    expect(LINT_ROLE_PROMPT).toContain("Lint");
    expect(MAIN_ROLE_PROMPT).toContain("协调");
  });
});

