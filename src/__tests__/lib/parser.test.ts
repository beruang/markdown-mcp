import { describe, it, expect } from "vitest";
import {
  parseMarkdown,
  stringifyMarkdown,
  extractHeadings,
  resolveHeading,
  toAnchorSlug,
  getLastLine,
} from "../../lib/parser.js";

describe("toAnchorSlug", () => {
  it("lowercases text", () => {
    expect(toAnchorSlug("Hello World")).toBe("hello-world");
  });

  it("strips non-alphanumeric except spaces/hyphens", () => {
    expect(toAnchorSlug("What's new? (2024)")).toBe("whats-new-2024");
  });

  it("collapses multiple hyphens", () => {
    expect(toAnchorSlug("Foo -- Bar")).toBe("foo-bar");
  });
});

describe("parseMarkdown", () => {
  it("parses empty string to empty tree", () => {
    const tree = parseMarkdown("");
    expect(tree.children).toHaveLength(0);
  });

  it("parses headings", () => {
    const tree = parseMarkdown("# Title\n\n## Section\n\ncontent");
    const headings = extractHeadings(tree);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatchObject({ level: 1, text: "Title" });
    expect(headings[1]).toMatchObject({ level: 2, text: "Section" });
  });

  it("does not treat # in code blocks as headings", () => {
    const md = [
      "# Real Heading",
      "",
      "```",
      "# this is code, not a heading",
      "```",
    ].join("\n");
    const tree = parseMarkdown(md);
    const headings = extractHeadings(tree);
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe("Real Heading");
  });

  it("supports Setext headings", () => {
    const md = ["Setext H1", "==========", "", "Setext H2", "----------"].join("\n");
    const tree = parseMarkdown(md);
    const headings = extractHeadings(tree);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatchObject({ level: 1, text: "Setext H1" });
    expect(headings[1]).toMatchObject({ level: 2, text: "Setext H2" });
  });

  it("handles unicode heading text", () => {
    const md = "# 日本語見出し\n\ncontent";
    const tree = parseMarkdown(md);
    const headings = extractHeadings(tree);
    expect(headings[0].text).toBe("日本語見出し");
  });
});

describe("resolveHeading", () => {
  it("resolves by exact text match", () => {
    const md = "# Title\n\n## Section One\n\ncontent\n\n## Section Two\n\nmore";
    const tree = parseMarkdown(md);
    const result = resolveHeading(tree, "Section One");
    expect(result).not.toBeNull();
    expect(result!.ambiguous).toBe(false);
    expect(result!.heading?.depth).toBe(2);
  });

  it("resolves by anchor slug", () => {
    const md = "## My Cool Section\n\ncontent";
    const tree = parseMarkdown(md);
    const result = resolveHeading(tree, "my-cool-section");
    expect(result).not.toBeNull();
    expect(result!.ambiguous).toBe(false);
  });

  it("returns ambiguous for duplicate headings", () => {
    const md = "## Dupe\n\nfirst\n\n## Dupe\n\nsecond";
    const tree = parseMarkdown(md);
    const result = resolveHeading(tree, "Dupe");
    expect(result).not.toBeNull();
    expect(result!.ambiguous).toBe(true);
    expect(result!.alternatives).toHaveLength(1);
  });

  it("returns null for missing heading", () => {
    const md = "# Title\n\ncontent";
    const tree = parseMarkdown(md);
    const result = resolveHeading(tree, "Nonexistent");
    expect(result).toBeNull();
  });
});

describe("getLastLine", () => {
  it("returns 0 for empty tree", () => {
    const tree = parseMarkdown("");
    expect(getLastLine(tree)).toBe(0);
  });

  it("returns last line number", () => {
    const md = "line 1\nline 2\nline 3";
    const tree = parseMarkdown(md);
    expect(getLastLine(tree)).toBe(3);
  });
});

describe("stringifyMarkdown", () => {
  it("round-trips markdown", () => {
    const md = "# Title\n\nSome **bold** text\n";
    const tree = parseMarkdown(md);
    const out = stringifyMarkdown(tree);
    expect(out).toContain("Title");
    expect(out).toContain("bold");
  });
});
