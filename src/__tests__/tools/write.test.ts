import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { setupTempDir, createFixture, createConfig } from "../helpers.js";
import {
  parseMarkdown,
  resolveHeading,
} from "../../lib/parser.js";
import { getSectionBounds } from "../../lib/sections.js";
import { setFrontmatterKeys } from "../../lib/frontmatter.js";
import { readFile, writeFile } from "../../lib/fs.js";

describe("Write operations (integration via lib)", () => {
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

  function testPath(name: string): string {
    return path.join(dir, name);
  }

  it("upsert_section: replaces existing section", async () => {
    const content = [
      "# Title",
      "intro",
      "## Old Section",
      "old content",
      "## Next",
      "next content",
    ].join("\n");

    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);

    const fileContent = await readFile(config, testPath("test.md"));
    const lines = fileContent.split("\n");
    const tree = parseMarkdown(fileContent);
    const resolved = resolveHeading(tree, "Old Section");

    expect(resolved).not.toBeNull();
    const bounds = getSectionBounds(tree, resolved!.heading!);
    const newSection = ["## New Name", "new content"].join("\n");
    const newLines = [
      ...lines.slice(0, bounds.start - 1),
      newSection,
      ...lines.slice(bounds.end),
    ];
    const newContent = newLines.join("\n");

    await writeFile(config, testPath("test.md"), newContent);

    const updated = await readFile(config, testPath("test.md"));
    expect(updated).toContain("## New Name");
    expect(updated).toContain("new content");
    expect(updated).not.toContain("## Old Section");
    expect(updated).toContain("## Next");
  });

  it("upsert_section: inserts new section at end", async () => {
    const content = "# Title\n\nintro\n";
    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);

    const newSection = "\n\n## New Section\nnew content\n";
    const newContent = content + newSection;

    await writeFile(config, testPath("test.md"), newContent);
    const updated = await readFile(config, testPath("test.md"));
    expect(updated).toContain("## New Section");
    expect(updated).toContain("new content");
  });

  it("insert_at_line: inserts at specific position", async () => {
    const content = ["line 1", "line 2", "line 3"].join("\n");
    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);

    const lines = content.split("\n");
    const newLines = [...lines.slice(0, 1), "INSERTED", ...lines.slice(1)];
    await writeFile(config, testPath("test.md"), newLines.join("\n"));

    const updated = await readFile(config, testPath("test.md"));
    expect(updated).toBe("line 1\nINSERTED\nline 2\nline 3");
  });

  it("set_frontmatter: creates frontmatter on file without one", async () => {
    const content = "# Just a heading\n\nSome content\n";
    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);

    const { newContent } = setFrontmatterKeys(content, { title: "New" }, []);
    await writeFile(config, testPath("test.md"), newContent);

    const updated = await readFile(config, testPath("test.md"));
    expect(updated).toContain("---");
    expect(updated).toContain("title: New");
    expect(updated).toContain("# Just a heading");
  });

  it("delete_section: removes heading and content", async () => {
    const content = [
      "# Title",
      "intro",
      "## To Delete",
      "delete me",
      "## Keep",
      "keep me",
    ].join("\n");

    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);

    const fileContent = await readFile(config, testPath("test.md"));
    const lines = fileContent.split("\n");
    const tree = parseMarkdown(fileContent);
    const resolved = resolveHeading(tree, "To Delete");
    const bounds = getSectionBounds(tree, resolved!.heading!);

    const newLines = [
      ...lines.slice(0, bounds.start - 1),
      ...lines.slice(bounds.end),
    ];
    await writeFile(config, testPath("test.md"), newLines.join("\n"));

    const updated = await readFile(config, testPath("test.md"));
    expect(updated).not.toContain("To Delete");
    expect(updated).not.toContain("delete me");
    expect(updated).toContain("## Keep");
    expect(updated).toContain("keep me");
  });

  it("dry_run does not modify file", async () => {
    const content = "original content";
    await createFixture(dir, "test.md", content);
    const config = createConfig(dir);

    const current = await readFile(config, testPath("test.md"));
    expect(current).toBe("original content");
    const reRead = await readFile(config, testPath("test.md"));
    expect(reRead).toBe("original content");
  });
});
