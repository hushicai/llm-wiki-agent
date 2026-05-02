// src/utils/log.ts tests
import { describe, expect, test, afterAll } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { getAgentDir } from "../src/core/config.js";
import {
  logSubagentStart,
  logSubagentEnd,
  logSubagentError,
} from "../src/utils/log.js";

const LOG_FILE = join(getAgentDir(), "tool.log");

describe("tool log", () => {
  afterAll(() => {
    // Clean up test entries (remove the file if it only contains test data)
    if (existsSync(LOG_FILE)) {
      const content = readFileSync(LOG_FILE, "utf-8").trim();
      // If empty or only test entries remain
      if (!content || content.split("\n").every((l: string) => l.includes("__test__"))) {
        unlinkSync(LOG_FILE);
      }
    }
  });

  test("logSubagentStart writes a JSON line", () => {
    const beforeSize = existsSync(LOG_FILE) ? readFileSync(LOG_FILE).length : 0;

    logSubagentStart("__test__agent", "__test__task");

    expect(existsSync(LOG_FILE)).toBe(true);
    const content = readFileSync(LOG_FILE, "utf-8").trim();
    const lines = content.split("\n");

    // File should have grown
    const afterSize = readFileSync(LOG_FILE).length;
    expect(afterSize).toBeGreaterThan(beforeSize);

    // Last line should be valid JSON with our event
    const lastLine = lines[lines.length - 1];
    const entry = JSON.parse(lastLine);
    expect(entry.event).toBe("subagent_start");
    expect(entry.agent).toBe("__test__agent");
    expect(entry.task).toBe("__test__task");
    expect(entry.ts).toBeDefined();
  });

  test("logSubagentEnd writes a JSON line", () => {
    logSubagentEnd("__test__agent", "__test__task", 0, 5, 100);

    const content = readFileSync(LOG_FILE, "utf-8").trim();
    const lines = content.split("\n");
    const lastLine = lines[lines.length - 1];
    const entry = JSON.parse(lastLine);
    expect(entry.event).toBe("subagent_end");
    expect(entry.agent).toBe("__test__agent");
    expect(entry.exitCode).toBe(0);
    expect(entry.messageCount).toBe(5);
    expect(entry.durationMs).toBe(100);
  });

  test("logSubagentError writes a JSON line", () => {
    logSubagentError("__test__agent", "__test__task", "something went wrong", 1, "stderr output", 200);

    const content = readFileSync(LOG_FILE, "utf-8").trim();
    const lines = content.split("\n");
    const lastLine = lines[lines.length - 1];
    const entry = JSON.parse(lastLine);
    expect(entry.event).toBe("subagent_error");
    expect(entry.agent).toBe("__test__agent");
    expect(entry.errorMessage).toBe("something went wrong");
    expect(entry.exitCode).toBe(1);
    expect(entry.stderrSummary).toBe("stderr output");
    expect(entry.durationMs).toBe(200);
  });

  test("all entries have ISO timestamp", () => {
    const content = readFileSync(LOG_FILE, "utf-8").trim();
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("__test__")) {
        const entry = JSON.parse(line);
        expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }
  });
});
