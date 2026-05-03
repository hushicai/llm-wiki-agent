// tests/server/session.test.ts — WebSessionManager unit tests
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { WebSessionManager } from "../../src/server/session.js";
import type { WikiAgent } from "../../src/core/agent.js";

// Mock WikiAgent that tracks createSession calls
function createMockAgent() {
  let callCount = 0;
  return {
    createSession: async (_wikiRoot: string) => {
      callCount++;
      return {
        session: { id: `session-${callCount}` },
        dispose: async () => {},
      };
    },
    getCallCount: () => callCount,
  };
}

describe("WebSessionManager", () => {
  let manager: WebSessionManager;

  beforeEach(() => {
    manager = new WebSessionManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  test("create returns id and runtime", async () => {
    const agent = createMockAgent();
    const result = await manager.create(agent as unknown as WikiAgent, "/tmp/test-wiki");
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(result.runtime).toBeDefined();
    expect(result.runtime.session).toBeDefined();
    expect(agent.getCallCount()).toBe(1);
  });

  test("create generates unique ids for multiple sessions", async () => {
    const agent = createMockAgent();
    const r1 = await manager.create(agent as any, "/tmp/test-wiki");
    const r2 = await manager.create(agent as any, "/tmp/test-wiki");
    expect(r1.id).not.toBe(r2.id);
  });

  test("get returns runtime for existing session", async () => {
    const agent = createMockAgent();
    const { id, runtime } = await manager.create(agent as unknown as WikiAgent, "/tmp/test-wiki");
    const got = manager.get(id);
    expect(got).toBe(runtime);
  });

  test("get returns undefined for non-existent session", () => {
    const result = manager.get("non-existent-id");
    expect(result).toBeUndefined();
  });

  test("remove disposes and deletes session", async () => {
    let disposed = false;
    const agent = {
      createSession: async () => ({
        session: {},
        dispose: async () => { disposed = true; },
      }),
    };
    const { id } = await manager.create(agent as unknown as WikiAgent, "/tmp/test-wiki");
    await manager.remove(id);
    expect(disposed).toBe(true);
    expect(manager.get(id)).toBeUndefined();
  });

  test("remove is safe for non-existent session", async () => {
    await expect(manager.remove("non-existent")).resolves.toBeUndefined();
  });

  test("dispose clears all sessions", async () => {
    const agent = createMockAgent();
    const { id: id1 } = await manager.create(agent as any, "/tmp/wiki-1");
    const { id: id2 } = await manager.create(agent as any, "/tmp/wiki-2");
    manager.dispose();
    expect(manager.get(id1)).toBeUndefined();
    expect(manager.get(id2)).toBeUndefined();
  });

  test("get updates lastActivity timestamp", async () => {
    const agent = createMockAgent();
    const { id } = await manager.create(agent as unknown as WikiAgent, "/tmp/test-wiki");
    // Access private sessions map via bracket notation to verify
    const entry = (manager as unknown as { sessions: Map<string, { lastActivity: number }> }).sessions.get(id)!;
    const before = entry.lastActivity;
    // Small delay to ensure timestamp changes
    await new Promise(r => setTimeout(r, 5));
    manager.get(id);
    expect(entry.lastActivity).toBeGreaterThan(before);
  });
});
