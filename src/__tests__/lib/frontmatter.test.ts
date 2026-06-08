import { describe, it, expect } from "vitest";
import {
  extractFrontmatter,
  serializeFrontmatter,
  setFrontmatterKeys,
  hasFrontmatter,
} from "../../lib/frontmatter.js";

const yamlFm = "---\ntitle: Test\nauthor: Alice\n---\n\n# Body content\n";
const tomlFm = "+++\ntitle = \"Test\"\nauthor = \"Alice\"\n+++\n\n# Body content\n";

describe("extractFrontmatter", () => {
  it("detects YAML frontmatter", () => {
    const result = extractFrontmatter(yamlFm);
    expect(result.format).toBe("yaml");
    expect(result.parsed).toEqual({ title: "Test", author: "Alice" });
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(4);
  });

  it("detects TOML frontmatter", () => {
    const result = extractFrontmatter(tomlFm);
    expect(result.format).toBe("toml");
    expect(result.parsed).toMatchObject({ title: "Test", author: "Alice" });
  });

  it("returns none for no frontmatter", () => {
    const result = extractFrontmatter("# Just a heading\n\ncontent");
    expect(result.format).toBe("none");
    expect(result.parsed).toEqual({});
  });

  it("handles empty file", () => {
    const result = extractFrontmatter("");
    expect(result.format).toBe("none");
  });

  it("handles empty frontmatter block", () => {
    const result = extractFrontmatter("---\n---\n\n# Content");
    expect(result.format).toBe("yaml");
    expect(result.parsed).toEqual({});
  });

  it("handles malformed YAML gracefully", () => {
    const result = extractFrontmatter("---\n: bad yaml : :\n---\n\ncontent");
    expect(result.format).toBe("yaml");
    expect(result.parsed).toEqual({});
  });
});

describe("hasFrontmatter", () => {
  it("returns true for YAML frontmatter", () => {
    expect(hasFrontmatter(yamlFm)).toBe(true);
  });

  it("returns true for TOML frontmatter", () => {
    expect(hasFrontmatter(tomlFm)).toBe(true);
  });

  it("returns false without frontmatter", () => {
    expect(hasFrontmatter("# heading")).toBe(false);
  });
});

describe("setFrontmatterKeys", () => {
  it("updates existing keys", () => {
    const { newContent, diff } = setFrontmatterKeys(
      yamlFm,
      { author: "Bob" },
      [],
    );
    expect(newContent).toContain("author: Bob");
    expect(newContent).toContain("title: Test");
    expect(diff.before).not.toBe("");
    expect(diff.after).not.toBe("");
  });

  it("removes keys", () => {
    const { newContent } = setFrontmatterKeys(
      yamlFm,
      {},
      ["author"],
    );
    expect(newContent).toContain("title: Test");
    expect(newContent).not.toContain("author");
  });

  it("creates new frontmatter when none exists", () => {
    const { newContent, diff } = setFrontmatterKeys(
      "# Just a heading",
      { title: "New" },
      [],
    );
    expect(newContent).toContain("---");
    expect(newContent).toContain("title: New");
    expect(newContent).toContain("# Just a heading");
  });
});
