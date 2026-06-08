import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MarkdownMcpConfig, McpResponse, HeadingEntry } from "../types.js";
import {
  outlineInputShape,
  sectionInputShape,
  linesInputShape,
  frontmatterInputShape,
} from "../types.js";
import { parseMarkdown, resolveHeading } from "../lib/parser.js";
import {
  computeAllSectionBounds,
  getSectionBounds,
  getSectionContent,
  getChildHeadings,
} from "../lib/sections.js";
import { extractFrontmatter } from "../lib/frontmatter.js";
import { readFile } from "../lib/fs.js";

// ── md_get_outline ───────────────────────────────────────────────────────

async function handleGetOutline(
  config: MarkdownMcpConfig,
  input: { file: string; max_depth?: number },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const totalLines = content.split("\n").length;
  const tree = parseMarkdown(content);
  const headings = computeAllSectionBounds(tree);

  const maxDepth = input.max_depth ?? 6;
  const filtered = headings
    .filter((h) => h.level <= maxDepth)
    .map((h) => ({
      level: h.level,
      text: h.text,
      anchor: h.anchor,
      line: h.line,
      end_line: h.end_line,
    }));

  return {
    file: input.file,
    operation: "get_outline",
    metadata: {
      total_lines: totalLines,
      heading_count: filtered.length,
      headings: filtered,
    },
  };
}

// ── md_get_section ───────────────────────────────────────────────────────

async function handleGetSection(
  config: MarkdownMcpConfig,
  input: {
    file: string;
    heading: string;
    include_children?: boolean;
    include_heading?: boolean;
  },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const lines = content.split("\n");
  const tree = parseMarkdown(content);
  const resolved = resolveHeading(tree, input.heading);

  if (!resolved || !resolved.heading) {
    return {
      file: input.file,
      operation: "get_section",
      error: `SECTION_NOT_FOUND: Heading "${input.heading}" not found`,
      error_code: "SECTION_NOT_FOUND",
    };
  }

  if (resolved.ambiguous && !input.heading) {
    return {
      file: input.file,
      operation: "get_section",
      error: `AMBIGUOUS_HEADING: Multiple headings match "${input.heading}"`,
      error_code: "AMBIGUOUS_HEADING",
      metadata: {
        heading_level: resolved.heading.depth,
        heading_text: input.heading,
        ambiguous: true,
        alternatives: resolved.alternatives,
      },
    };
  }

  const includeChildren = input.include_children ?? true;
  const includeHeading = input.include_heading ?? true;
  let bounds = getSectionBounds(tree, resolved.heading);

  if (!includeChildren) {
    // End at the first child heading (or keep original if no children)
    const childHeadings = getChildHeadings(tree, resolved.heading);
    if (childHeadings.length > 0) {
      bounds = { ...bounds, end: childHeadings[0].line - 1 };
    }
  }

  const childSections = getChildHeadings(tree, resolved.heading);

  return {
    file: input.file,
    operation: "get_section",
    start_line: bounds.start,
    end_line: bounds.end,
    content: getSectionContent(lines, bounds, includeHeading),
    metadata: {
      heading_level: resolved.heading.depth,
      heading_text: input.heading,
      ambiguous: resolved.ambiguous,
      alternatives: resolved.alternatives,
      child_sections: childSections.map((c) => c.text),
    },
  };
}

// ── md_get_lines ─────────────────────────────────────────────────────────

async function handleGetLines(
  config: MarkdownMcpConfig,
  input: { file: string; start_line: number; end_line: number },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (
    input.start_line < 1 ||
    input.end_line > totalLines ||
    input.start_line > input.end_line
  ) {
    return {
      file: input.file,
      operation: "get_lines",
      error: `INVALID_LINE_RANGE: start_line=${input.start_line}, end_line=${input.end_line}, total_lines=${totalLines}`,
      error_code: "INVALID_LINE_RANGE",
    };
  }

  const sliced = lines.slice(input.start_line - 1, input.end_line);

  return {
    file: input.file,
    operation: "get_lines",
    start_line: input.start_line,
    end_line: input.end_line,
    content: sliced.join("\n"),
    metadata: {
      total_lines: totalLines,
      lines_returned: sliced.length,
    },
  };
}

// ── md_get_frontmatter ───────────────────────────────────────────────────

async function handleGetFrontmatter(
  config: MarkdownMcpConfig,
  input: { file: string; keys?: string[] },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const fm = extractFrontmatter(content);

  let parsed = fm.parsed;
  if (input.keys && input.keys.length > 0) {
    const subset: Record<string, unknown> = {};
    for (const k of input.keys) {
      if (k in parsed) subset[k] = parsed[k];
    }
    parsed = subset;
  }

  return {
    file: input.file,
    operation: "get_frontmatter",
    start_line: fm.startLine || 1,
    end_line: fm.endLine || 0,
    content: fm.raw || "",
    metadata: {
      format: fm.format,
      parsed,
    },
  };
}

// ── Registration ─────────────────────────────────────────────────────────

export function registerReadTools(
  server: McpServer,
  config: MarkdownMcpConfig,
): void {
  server.tool(
    "md_get_outline",
    "Returns all headings in the file with their levels and line numbers",
    outlineInputShape,
    async (input) => {
      const resp = await handleGetOutline(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.tool(
    "md_get_section",
    "Returns the content of a specific section identified by heading text or anchor slug",
    sectionInputShape,
    async (input) => {
      const resp = await handleGetSection(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.tool(
    "md_get_lines",
    "Returns a specific line range from the file",
    linesInputShape,
    async (input) => {
      const resp = await handleGetLines(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.tool(
    "md_get_frontmatter",
    "Extracts and parses only the YAML or TOML frontmatter block from the file",
    frontmatterInputShape,
    async (input) => {
      const resp = await handleGetFrontmatter(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );
}
