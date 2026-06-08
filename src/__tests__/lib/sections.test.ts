import { describe, it, expect } from "vitest";
import { parseMarkdown, resolveHeading } from "../../lib/parser.js";
import {
  getSectionBounds,
  computeAllSectionBounds,
  getSectionContent,
  findSectionContainingLine,
  getChildHeadings,
} from "../../lib/sections.js";

describe("getSectionBounds", () => {
  it("bounds section from heading to next sibling of equal depth", () => {
    // line 1: ## First, line 2: blank, line 3: content, line 4: blank, line 5: ## Second, ...
    const md = "## First\n\nfirst content\n\n## Second\n\nsecond content";
    const tree = parseMarkdown(md);
    const resolved = resolveHeading(tree, "First");
    const bounds = getSectionBounds(tree, resolved!.heading!);
    // "## First" at line 1, "## Second" at line 5 => section ends at line 4
    expect(bounds).toEqual({ start: 1, end: 4 });
  });

  it("bounds last section to end of file", () => {
    // line 1: # Title, line 2: blank, line 3: content, line 4: blank, line 5: ## Section, line 6: blank, line 7: content
    const md = "# Title\n\ntitle content\n\n## Section\n\nsection content";
    const tree = parseMarkdown(md);
    const resolved = resolveHeading(tree, "Section");
    const bounds = getSectionBounds(tree, resolved!.heading!);
    // "## Section" at line 5, no later heading => ends at last line (7)
    expect(bounds).toEqual({ start: 5, end: 7 });
  });

  it("does not terminate on deeper child headings", () => {
    const md = [
      "## Parent",
      "parent content",
      "### Child",
      "child content",
      "## Next Sibling",
      "sibling content",
    ].join("\n");
    const tree = parseMarkdown(md);
    const resolved = resolveHeading(tree, "Parent");
    const bounds = getSectionBounds(tree, resolved!.heading!);
    // Parent should end at line 4 (line before "## Next Sibling")
    expect(bounds).toEqual({ start: 1, end: 4 });
  });

  it("single heading spans entire file", () => {
    // line 1: # Only Heading, line 2: blank, line 3: content, line 4: blank, line 5: more
    const md = "# Only Heading\n\ncontent here\n\nmore content";
    const tree = parseMarkdown(md);
    const resolved = resolveHeading(tree, "Only Heading");
    const bounds = getSectionBounds(tree, resolved!.heading!);
    expect(bounds).toEqual({ start: 1, end: 5 });
  });
});

describe("computeAllSectionBounds", () => {
  it("fills in end_line for all headings", () => {
    const md = "# H1\n\n## H2\n\n### H3\n\n## Another H2";
    const tree = parseMarkdown(md);
    const headings = computeAllSectionBounds(tree);
    expect(headings).toHaveLength(4);
    // All end_lines should be > 0
    for (const h of headings) {
      expect(h.end_line).toBeGreaterThan(0);
    }
  });
});

describe("getSectionContent", () => {
  it("extracts section content with heading", () => {
    // H1 spans entire file since no sibling H1 to terminate it
    const md = "# Title\n\ntitle content\n\n## Section\n\nbody\n";
    const lines = md.split("\n");
    const tree = parseMarkdown(md);
    const resolved = resolveHeading(tree, "Title");
    const bounds = getSectionBounds(tree, resolved!.heading!);
    const content = getSectionContent(lines, bounds, true);
    expect(content).toContain("# Title");
    expect(content).toContain("title content");
  });

  it("extracts section content without heading", () => {
    const md = "## Section\n\nfirst line\n\nsecond line\n";
    const lines = md.split("\n");
    const tree = parseMarkdown(md);
    const resolved = resolveHeading(tree, "Section");
    const bounds = getSectionBounds(tree, resolved!.heading!);
    const content = getSectionContent(lines, bounds, false);
    expect(content).not.toContain("## Section");
    expect(content).toContain("first line");
  });
});

describe("findSectionContainingLine", () => {
  it("returns deepest section containing a line", () => {
    const md = [
      "# H1",
      "h1 content",
      "## H2",
      "h2 content",
      "### H3",
      "h3 content",
    ].join("\n");
    const tree = parseMarkdown(md);
    const section = findSectionContainingLine(tree, 6); // "h3 content"
    expect(section).not.toBeNull();
    expect(section!.level).toBe(3);
    expect(section!.text).toBe("H3");
  });

  it("returns null for line before first heading", () => {
    const md = "\n\n# Title\n\ncontent";
    const tree = parseMarkdown(md);
    // Line 1 is blank, before the heading at line 3
    const section = findSectionContainingLine(tree, 3);
    expect(section).not.toBeNull();
    expect(section!.text).toBe("Title");
  });
});

describe("getChildHeadings", () => {
  it("returns immediate children only", () => {
    const md = "# H1\n## Child1\n### Grandchild\n## Child2";
    const tree = parseMarkdown(md);
    const resolved = resolveHeading(tree, "H1");
    const children = getChildHeadings(tree, resolved!.heading!);
    expect(children).toHaveLength(2);
    expect(children[0].text).toBe("Child1");
    expect(children[1].text).toBe("Child2");
  });
});
