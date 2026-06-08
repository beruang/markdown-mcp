import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MarkdownMcpConfig, McpResponse, DiffResult } from "../types.js";
import {
  upsertSectionInputShape,
  appendSectionInputShape,
  insertAtLineInputShape,
  replaceTextInputShape,
  setFrontmatterInputShape,
  deleteSectionInputShape,
} from "../types.js";
import {
  parseMarkdown,
  resolveHeading,
  stringifyMarkdown,
} from "../lib/parser.js";
import { getSectionBounds, getChildHeadings } from "../lib/sections.js";
import { setFrontmatterKeys } from "../lib/frontmatter.js";
import { readFile, writeFile, withFileLock, resolvePath } from "../lib/fs.js";

function makeDiff(startLine: number, endLine: number, before: string, after: string): DiffResult {
  return { start_line: startLine, end_line: endLine, before, after };
}

// ── md_upsert_section ────────────────────────────────────────────────────

type UpsertResult = McpResponse<{
  action: "replaced" | "inserted";
  heading: string;
  heading_level: number;
}>;

async function handleUpsertSection(
  config: MarkdownMcpConfig,
  input: {
    file: string;
    heading: string;
    content: string;
    heading_level?: number;
    insert_after?: string;
    insert_position?: "start" | "end";
    dry_run?: boolean;
  },
): Promise<UpsertResult> {
  const content = await readFile(config, input.file);
  const lines = content.split("\n");
  const tree = parseMarkdown(content);
  const resolved = resolveHeading(tree, input.heading);

  if (resolved && resolved.heading && !resolved.ambiguous) {
    // Replace existing section
    const bounds = getSectionBounds(tree, resolved.heading);
    const headingLine = lines[bounds.start - 1];
    const level = resolved.heading.depth;
    const prefix = "#".repeat(level) + " ";

    // Rebuild section: heading line + content
    const newHeadingLine = prefix + input.heading;
    const newSectionLines = [newHeadingLine, input.content];
    const newSection = newSectionLines.join("\n");

    const before = lines.slice(bounds.start - 1, bounds.end).join("\n");
    const newLines = [
      ...lines.slice(0, bounds.start - 1),
      newSection,
      ...lines.slice(bounds.end),
    ];
    const newContent = newLines.join("\n");

    const resp: UpsertResult = {
      file: input.file,
      operation: "upsert_section",
      diff: makeDiff(bounds.start, bounds.end, before, newSection),
      metadata: { action: "replaced", heading: input.heading, heading_level: level },
    };

    if (!input.dry_run) {
      await withFileLock(resolvePath(config, input.file), () =>
        writeFile(config, input.file, newContent),
      );
    }

    return resp;
  }

  // Insert new section
  const level = input.heading_level ?? 2;
  const headingPrefix = "#".repeat(level) + " ";
  const newSectionLines = [headingPrefix + input.heading, input.content];
  const newSection = newSectionLines.join("\n");

  let insertAt: number;
  if (input.insert_after) {
    const afterResolved = resolveHeading(tree, input.insert_after);
    if (!afterResolved || !afterResolved.heading) {
      return {
        file: input.file,
        operation: "upsert_section",
        error: `SECTION_NOT_FOUND: insert_after heading "${input.insert_after}" not found`,
        error_code: "SECTION_NOT_FOUND",
      };
    }
    const bounds = getSectionBounds(tree, afterResolved.heading);
    insertAt = bounds.end + 1;
  } else if (input.insert_position === "start") {
    insertAt = 1;
  } else {
    // Default: insert at end
    insertAt = lines.length + 1;
  }

  const before = ""; // nothing was there before
  const newLines = [...lines];
  newLines.splice(insertAt - 1, 0, newSection + (insertAt <= lines.length ? "\n" : ""));
  const newContent = newLines.join("\n");

  const resp: UpsertResult = {
    file: input.file,
    operation: "upsert_section",
    diff: makeDiff(insertAt, insertAt + newSectionLines.length - 1, before, newSection),
    metadata: { action: "inserted", heading: input.heading, heading_level: level },
  };

  if (!input.dry_run) {
    await withFileLock(resolvePath(config, input.file), () =>
      writeFile(config, input.file, newContent),
    );
  }

  return resp;
}

// ── md_append_to_section ─────────────────────────────────────────────────

async function handleAppendToSection(
  config: MarkdownMcpConfig,
  input: {
    file: string;
    heading: string;
    content: string;
    dry_run?: boolean;
  },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const lines = content.split("\n");
  const tree = parseMarkdown(content);
  const resolved = resolveHeading(tree, input.heading);

  if (!resolved || !resolved.heading || resolved.ambiguous) {
    return {
      file: input.file,
      operation: "append_to_section",
      error: `SECTION_NOT_FOUND: "${input.heading}"`,
      error_code: "SECTION_NOT_FOUND",
    };
  }

  const bounds = getSectionBounds(tree, resolved.heading);
  const insertAt = bounds.end + 1;
  const newLines = [...lines];
  newLines.splice(insertAt - 1, 0, input.content);

  const newContent = newLines.join("\n");
  const diff = makeDiff(insertAt, insertAt + input.content.split("\n").length - 1, "", input.content);

  if (!input.dry_run) {
    await withFileLock(resolvePath(config, input.file), () =>
      writeFile(config, input.file, newContent),
    );
  }

  return {
    file: input.file,
    operation: "append_to_section",
    diff,
    metadata: {
      heading: input.heading,
      appended_lines: input.content.split("\n").length,
    },
  };
}

// ── md_insert_at_line ────────────────────────────────────────────────────

async function handleInsertAtLine(
  config: MarkdownMcpConfig,
  input: {
    file: string;
    line: number;
    content: string;
    dry_run?: boolean;
  },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const lines = content.split("\n");

  if (input.line > lines.length + 1) {
    return {
      file: input.file,
      operation: "insert_at_line",
      error: `INVALID_LINE_RANGE: line=${input.line} exceeds total_lines=${lines.length} + 1`,
      error_code: "INVALID_LINE_RANGE",
    };
  }

  const insertIdx = input.line - 1;
  const insertion = input.content.split("\n");
  const newLines = [...lines];
  newLines.splice(insertIdx, 0, ...insertion);

  const newContent = newLines.join("\n");
  const diff = makeDiff(input.line, input.line + insertion.length - 1, "", input.content);

  if (!input.dry_run) {
    await withFileLock(resolvePath(config, input.file), () =>
      writeFile(config, input.file, newContent),
    );
  }

  return {
    file: input.file,
    operation: "insert_at_line",
    diff,
  };
}

// ── md_replace_text ──────────────────────────────────────────────────────

async function handleReplaceText(
  config: MarkdownMcpConfig,
  input: {
    file: string;
    find: string;
    replace: string;
    is_regex?: boolean;
    case_sensitive?: boolean;
    scope_section?: string;
    replace_all?: boolean;
    dry_run?: boolean;
  },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const lines = content.split("\n");
  const tree = parseMarkdown(content);

  const isRegex = input.is_regex ?? false;
  const caseSensitive = input.case_sensitive ?? false;
  const replaceAll = input.replace_all ?? true;

  let scopeStart = 0;
  let scopeEnd = lines.length - 1;
  if (input.scope_section) {
    const resolved = resolveHeading(tree, input.scope_section);
    if (!resolved || !resolved.heading) {
      return {
        file: input.file,
        operation: "replace_text",
        error: `SECTION_NOT_FOUND: "${input.scope_section}"`,
        error_code: "SECTION_NOT_FOUND",
      };
    }
    const bounds = getSectionBounds(tree, resolved.heading);
    scopeStart = bounds.start - 1;
    scopeEnd = bounds.end - 1;
  }

  let replacementsMade = 0;
  const linesAffected: number[] = [];
  const newLines = [...lines];
  const flags = `${caseSensitive ? "" : "i"}${replaceAll ? "g" : ""}`;

  for (let i = scopeStart; i <= scopeEnd; i++) {
    const line = lines[i];
    let newLine: string;

    if (isRegex) {
      const re = new RegExp(input.find, flags);
      if (re.test(line)) {
        // Reset lastIndex since test() mutates the regex with g flag
        const re2 = new RegExp(input.find, flags);
        newLine = line.replace(re2, input.replace);
        replacementsMade++;
        linesAffected.push(i + 1);
      } else {
        newLine = line;
      }
    } else {
      if (caseSensitive) {
        newLine = line.replaceAll(input.find, input.replace);
        if (newLine !== line) {
          const count = (line.match(new RegExp(input.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
          replacementsMade += replaceAll ? count : 1;
          linesAffected.push(i + 1);
          if (!replaceAll) {
            newLine = line.replace(input.find, input.replace);
          }
        } else {
          newLine = line;
        }
      } else {
        const lowerLine = line.toLowerCase();
        const lowerFind = input.find.toLowerCase();
        const re = new RegExp(input.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), replaceAll ? "gi" : "i");
        const matchCount = (line.match(re) || []).length;
        if (matchCount > 0) {
          newLine = replaceAll
            ? line.replace(re, input.replace)
            : line.replace(new RegExp(input.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), input.replace);
          replacementsMade += matchCount;
          linesAffected.push(i + 1);
        } else {
          newLine = line;
        }
      }

      if (!replaceAll && replacementsMade > 0) {
        // Stop after first replacement for non-replace_all
        newLines[i] = newLine;
        break;
      }
    }

    newLines[i] = newLine;
  }

  const before = lines.slice(scopeStart, scopeEnd + 1).join("\n");
  const after = newLines.slice(scopeStart, scopeEnd + 1).join("\n");

  const diff = makeDiff(scopeStart + 1, scopeEnd + 1, before, after);
  const newContent = newLines.join("\n");

  if (!input.dry_run) {
    await withFileLock(resolvePath(config, input.file), () =>
      writeFile(config, input.file, newContent),
    );
  }

  return {
    file: input.file,
    operation: "replace_text",
    diff,
    metadata: {
      replacements_made: replacementsMade,
      lines_affected: linesAffected,
    },
  };
}

// ── md_set_frontmatter ───────────────────────────────────────────────────

async function handleSetFrontmatter(
  config: MarkdownMcpConfig,
  input: {
    file: string;
    updates: Record<string, unknown>;
    remove_keys?: string[];
    dry_run?: boolean;
  },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const removeKeys = input.remove_keys ?? [];

  const { newContent, diff } = setFrontmatterKeys(content, input.updates, removeKeys);

  const keysUpdated = Object.keys(input.updates);
  const keysAdded = Object.keys(input.updates);
  const keysRemoved = removeKeys;

  if (!input.dry_run) {
    await withFileLock(resolvePath(config, input.file), () =>
      writeFile(config, input.file, newContent),
    );
  }

  return {
    file: input.file,
    operation: "set_frontmatter",
    diff,
    metadata: {
      keys_updated: keysUpdated,
      keys_removed: keysRemoved,
      keys_added: keysAdded,
    },
  };
}

// ── md_delete_section ────────────────────────────────────────────────────

async function handleDeleteSection(
  config: MarkdownMcpConfig,
  input: {
    file: string;
    heading: string;
    include_children?: boolean;
    dry_run?: boolean;
  },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const lines = content.split("\n");
  const tree = parseMarkdown(content);
  const resolved = resolveHeading(tree, input.heading);

  if (!resolved || !resolved.heading) {
    return {
      file: input.file,
      operation: "delete_section",
      error: `SECTION_NOT_FOUND: "${input.heading}"`,
      error_code: "SECTION_NOT_FOUND",
    };
  }

  const includeChildren = input.include_children ?? true;
  let bounds = getSectionBounds(tree, resolved.heading);

  let childSectionsDeleted: string[] = [];
  if (!includeChildren) {
    // Only delete the heading line and content up to the first child heading
    const children = getChildHeadings(tree, resolved.heading);
    if (children.length > 0) {
      bounds = { ...bounds, end: children[0].line - 1 };
    }
  } else {
    // Track deleted children
    const allHeadings = getChildHeadings(tree, resolved.heading);
    childSectionsDeleted = allHeadings.map((h) => h.text);
  }

  const deletedLines = lines.slice(bounds.start - 1, bounds.end);
  const before = deletedLines.join("\n");
  const newLines = [...lines.slice(0, bounds.start - 1), ...lines.slice(bounds.end)];
  const newContent = newLines.join("\n");

  const diff = makeDiff(bounds.start, bounds.end, before, "");

  if (!input.dry_run) {
    await withFileLock(resolvePath(config, input.file), () =>
      writeFile(config, input.file, newContent),
    );
  }

  return {
    file: input.file,
    operation: "delete_section",
    diff,
    metadata: {
      heading: input.heading,
      lines_deleted: bounds.end - bounds.start + 1,
      child_sections_deleted: childSectionsDeleted,
    },
  };
}

// ── Registration ─────────────────────────────────────────────────────────

export function registerWriteTools(
  server: McpServer,
  config: MarkdownMcpConfig,
): void {
  if (config.read_only) return;

  server.tool(
    "md_upsert_section",
    "Insert a new section or replace an existing one by heading",
    upsertSectionInputShape,
    async (input) => {
      const resp = await handleUpsertSection(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.tool(
    "md_append_to_section",
    "Append content to the end of a section without replacing it",
    appendSectionInputShape,
    async (input) => {
      const resp = await handleAppendToSection(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.tool(
    "md_insert_at_line",
    "Insert content at a specific line number",
    insertAtLineInputShape,
    async (input) => {
      const resp = await handleInsertAtLine(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.tool(
    "md_replace_text",
    "Find and replace a text string or regex pattern across the file (or within a section)",
    replaceTextInputShape,
    async (input) => {
      const resp = await handleReplaceText(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.tool(
    "md_set_frontmatter",
    "Update or insert specific frontmatter keys without touching the document body",
    setFrontmatterInputShape,
    async (input) => {
      const resp = await handleSetFrontmatter(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.tool(
    "md_delete_section",
    "Remove a heading and its entire content block",
    deleteSectionInputShape,
    async (input) => {
      const resp = await handleDeleteSection(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );
}
