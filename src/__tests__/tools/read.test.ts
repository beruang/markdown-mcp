import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { setupTempDir, createFixture, createConfig } from "../helpers.js";
import { readFile } from "../../lib/fs.js";
import {
  parseMarkdown,
  extractHeadings,
  resolveHeading,
} from "../../lib/parser.js";
import {
  computeAllSectionBounds,
  getSectionBounds,
  getSectionContent,
  getChildHeadings,
} from "../../lib/sections.js";
import { extractFrontmatter } from "../../lib/frontmatter.js";

// These test the internal handler functions by calling lib functions directly.
// This validates the core logic without MCP transport.

describe("Read operations (integration via lib)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = setupTempDir();
    dir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("get_outline flow: parses all headings", async () => {
    const content = [
      "# Title",
      "intro",
      "## Section One",
      "content one",
      "### Deep",
      "deep content",
      "## Section Two",
      "content two",
    ].join("\n");

    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);
    const fileContent = await readFile(config, path.join(dir, "test.md"));
    const tree = parseMarkdown(fileContent);
    const headings = computeAllSectionBounds(tree);

    expect(headings).toHaveLength(4);
    expect(headings[0]).toMatchObject({ level: 1, text: "Title" });
    expect(headings[1]).toMatchObject({ level: 2, text: "Section One" });
    expect(headings[2]).toMatchObject({ level: 3, text: "Deep" });
    expect(headings[3]).toMatchObject({ level: 2, text: "Section Two" });
  });

  it("get_section flow: extracts section by heading", async () => {
    const content = [
      "# Title",
      "intro text",
      "",
      "## Section One",
      "section one content",
      "",
      "## Section Two",
      "section two content",
    ].join("\n");

    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);
    const fileContent = await readFile(config, path.join(dir, "test.md"));
    const lines = fileContent.split("\n");
    const tree = parseMarkdown(fileContent);
    const resolved = resolveHeading(tree, "Section One");

    expect(resolved).not.toBeNull();
    const bounds = getSectionBounds(tree, resolved!.heading!);
    const sectionContent = getSectionContent(lines, bounds, true);

    expect(sectionContent).toContain("## Section One");
    expect(sectionContent).toContain("section one content");
    expect(sectionContent).not.toContain("## Section Two");
  });

  it("get_section flow: returns children headings", async () => {
    const content = [
      "# Title",
      "intro",
      "## Child A",
      "content a",
      "## Child B",
      "content b",
    ].join("\n");

    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);
    const fileContent = await readFile(config, path.join(dir, "test.md"));
    const tree = parseMarkdown(fileContent);
    const resolved = resolveHeading(tree, "Title");
    const children = getChildHeadings(tree, resolved!.heading!);

    expect(children).toHaveLength(2);
    expect(children[0].text).toBe("Child A");
    expect(children[1].text).toBe("Child B");
  });

  it("get_frontmatter flow: extracts YAML frontmatter", async () => {
    const content = [
      "---",
      "title: Hello",
      "tags: [a, b]",
      "---",
      "",
      "# Body",
      "content",
    ].join("\n");

    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);
    const fileContent = await readFile(config, path.join(dir, "test.md"));
    const fm = extractFrontmatter(fileContent);

    expect(fm.format).toBe("yaml");
    expect(fm.parsed).toMatchObject({ title: "Hello" });
  });

  it("empty file: outline returns empty", async () => {
    await createFixture(dir, "empty.md", "");
    const config = createConfig(dir);
    const fileContent = await readFile(config, path.join(dir, "empty.md"));
    const tree = parseMarkdown(fileContent);
    const headings = computeAllSectionBounds(tree);

    expect(headings).toHaveLength(0);
  });

  it("file with no headings: section ops error", async () => {
    const content = "Just some text\nwithout headings\n";
    await createFixture(dir, "nohead.md", content);
    const config = createConfig(dir);
    const fileContent = await readFile(config, path.join(dir, "nohead.md"));
    const tree = parseMarkdown(fileContent);
    const resolved = resolveHeading(tree, "Anything");

    expect(resolved).toBeNull();
  });
});
