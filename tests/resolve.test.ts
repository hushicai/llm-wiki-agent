// src/utils/resolve.ts tests
import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { getRepoRoot } from "../src/utils/resolve.js";

describe("getRepoRoot", () => {
  test("returns an absolute path", () => {
    const root = getRepoRoot();
    expect(root.startsWith("/")).toBe(true);
  });

  test("path exists on disk", () => {
    const root = getRepoRoot();
    expect(existsSync(root)).toBe(true);
  });

  test("contains package.json", () => {
    const root = getRepoRoot();
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });

  test("contains src/ directory", () => {
    const root = getRepoRoot();
    expect(existsSync(join(root, "src"))).toBe(true);
  });
});
