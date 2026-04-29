import { describe, expect, test } from "bun:test";
import { execSync } from "child_process";

describe("Build", () => {
  test("TypeScript compiles without errors", () => {
    execSync("bun run build", { cwd: import.meta.dir, stdio: "pipe" });
  });
});
