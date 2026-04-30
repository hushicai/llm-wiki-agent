import { describe, expect, test } from "bun:test";
import { getAgentDir, getSessionDir, getModelsPath, getAuthPath, getSettingsPath, slugify } from "../src/core/config.js";

describe("Config", () => {
  describe("getAgentDir", () => {
    test("returns path ending in .llm-wiki-agent", () => {
      const path = getAgentDir();
      expect(path).toContain(".llm-wiki-agent");
    });
  });

  describe("getSessionDir", () => {
    test("returns path with wiki slug", () => {
      const path = getSessionDir("my-wiki");
      expect(path).toContain("sessions");
      expect(path).toContain("my-wiki");
    });
  });

  describe("getModelsPath", () => {
    test("returns path ending in models.json", () => {
      const path = getModelsPath();
      expect(path).toContain("models.json");
    });
  });

  describe("getAuthPath", () => {
    test("returns path ending in auth.json", () => {
      const path = getAuthPath();
      expect(path).toContain("auth.json");
    });
  });

  describe("getSettingsPath", () => {
    test("returns path ending in settings.json", () => {
      const path = getSettingsPath();
      expect(path).toContain("settings.json");
    });
  });

  describe("slugify", () => {
    test("replaces special chars with underscores", () => {
      expect(slugify("My Wiki")).toBe("my_wiki");
      expect(slugify("hello-world")).toBe("hello-world");
      expect(slugify("path/to/wiki")).toBe("path_to_wiki");
    });
  });
});
