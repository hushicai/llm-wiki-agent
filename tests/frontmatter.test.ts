// Frontmatter utility tests
import { describe, expect, test } from "bun:test";
import { parseFrontmatter, stripFrontmatter, formatFrontmatter, mergeFrontmatter } from "../src/utils/frontmatter.js";

describe("parseFrontmatter", () => {
  test("parses YAML frontmatter with --- delimiters", () => {
    const content = `---
title: Test Page
type: concept
tags: [test, demo]
---
Page content here.`;
    const result = parseFrontmatter(content);
    expect(result.frontmatter.title).toBe("Test Page");
    expect(result.frontmatter.type).toBe("concept");
    expect(result.frontmatter.tags).toEqual(["test", "demo"]);
    expect(result.body.trim()).toBe("Page content here.");
  });

  test("returns empty frontmatter for content without frontmatter", () => {
    const content = "# Just a heading\n\nSome content.";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body.trim()).toBe("# Just a heading\n\nSome content.");
  });

  test("handles empty frontmatter", () => {
    const content = `---
---
Content after empty frontmatter.`;
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body.trim()).toBe("Content after empty frontmatter.");
  });

  test("handles content with no trailing newline after ---", () => {
    const content = `---
title: No Newline
---
Content`;
    const result = parseFrontmatter(content);
    expect(result.frontmatter.title).toBe("No Newline");
    expect(result.body.trim()).toBe("Content");
  });
});

describe("stripFrontmatter", () => {
  test("removes frontmatter from content", () => {
    const content = `---
title: Test
---
Body text`;
    expect(stripFrontmatter(content).trim()).toBe("Body text");
  });

  test("returns original content when no frontmatter", () => {
    const content = "# Just content";
    expect(stripFrontmatter(content)).toBe(content);
  });
});

describe("formatFrontmatter", () => {
  test("formats object as YAML frontmatter string", () => {
    const fm = { title: "Test", type: "concept" };
    const result = formatFrontmatter(fm);
    expect(result).toContain("---\n");
    expect(result).toContain("title: Test");
    expect(result).toContain("type: concept");
    expect(result).toContain("\n---\n");
  });

  test("handles tags array", () => {
    const fm = { title: "Test", tags: ["a", "b"] };
    const result = formatFrontmatter(fm);
    expect(result).toContain("tags:");
    expect(result).toContain("- a");
    expect(result).toContain("- b");
  });
});

describe("mergeFrontmatter", () => {
  test("merges overrides into existing frontmatter", () => {
    const existing = { title: "Original", type: "concept" };
    const merged = mergeFrontmatter(existing, { updated: "2026-04-29" });
    expect(merged.title).toBe("Original");
    expect(merged.type).toBe("concept");
    expect(merged.updated).toBe("2026-04-29");
  });

  test("overrides existing fields", () => {
    const existing = { title: "Old Title", updated: "2026-04-01" };
    const merged = mergeFrontmatter(existing, { updated: "2026-04-29" });
    expect(merged.title).toBe("Old Title");
    expect(merged.updated).toBe("2026-04-29");
  });

  test("handles null existing frontmatter", () => {
    const merged = mergeFrontmatter(null, { title: "New" });
    expect(merged.title).toBe("New");
  });
});
