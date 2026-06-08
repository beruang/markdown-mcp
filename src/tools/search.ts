import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MarkdownMcpConfig, McpResponse } from "../types.js";
import { searchInputShape } from "../types.js";
import { parseMarkdown, resolveHeading } from "../lib/parser.js";
import { getSectionBounds, findSectionContainingLine } from "../lib/sections.js";
import { readFile } from "../lib/fs.js";

interface SearchMatch {
  line: number;
  content: string;
  context_before: string[];
  context_after: string[];
  section_heading: string;
}

async function handleSearch(
  config: MarkdownMcpConfig,
  input: {
    file: string;
    query: string;
    is_regex?: boolean;
    case_sensitive?: boolean;
    context_lines?: number;
    max_results?: number;
    section?: string;
  },
): Promise<McpResponse> {
  const content = await readFile(config, input.file);
  const lines = content.split("\n");
  const tree = parseMarkdown(content);

  const isRegex = input.is_regex ?? false;
  const caseSensitive = input.case_sensitive ?? false;
  const contextLines = input.context_lines ?? 3;
  const maxResults = input.max_results ?? 20;

  // Determine search scope
  let scopeStart = 0;
  let scopeEnd = lines.length - 1;
  if (input.section) {
    const resolved = resolveHeading(tree, input.section);
    if (!resolved || !resolved.heading) {
      return {
        file: input.file,
        operation: "search",
        error: `SECTION_NOT_FOUND: "${input.section}"`,
        error_code: "SECTION_NOT_FOUND",
      };
    }
    const bounds = getSectionBounds(tree, resolved.heading);
    scopeStart = bounds.start - 1; // 0-indexed
    scopeEnd = bounds.end - 1;
  }

  // Build the test function
  let testFn: (line: string) => boolean;
  if (isRegex) {
    try {
      const flags = caseSensitive ? "g" : "gi";
      const re = new RegExp(input.query, flags);
      testFn = (line) => re.test(line);
    } catch {
      return {
        file: input.file,
        operation: "search",
        error: `INVALID_INPUT: Invalid regex pattern: ${input.query}`,
        error_code: "INVALID_INPUT",
      };
    }
  } else {
    if (caseSensitive) {
      testFn = (line) => line.includes(input.query);
    } else {
      const q = input.query.toLowerCase();
      testFn = (line) => line.toLowerCase().includes(q);
    }
  }

  const matches: SearchMatch[] = [];

  for (let i = scopeStart; i <= scopeEnd && matches.length < maxResults; i++) {
    if (testFn(lines[i])) {
      // Remove the regex flags that cause issues with multiline mode
      const ctxStart = Math.max(scopeStart, i - contextLines);
      const ctxEnd = Math.min(scopeEnd, i + contextLines);

      const sectionHeading = findSectionContainingLine(tree, i + 1);

      matches.push({
        line: i + 1,
        content: lines[i],
        context_before: lines.slice(ctxStart, i),
        context_after: lines.slice(i + 1, ctxEnd + 1),
        section_heading: sectionHeading?.text ?? "(no section)",
      });
    }
  }

  return {
    file: input.file,
    operation: "search",
    metadata: {
      query: input.query,
      total_matches: matches.length,
      section_scoped: input.section,
      results: matches,
    },
  };
}

export function registerSearchTools(
  server: McpServer,
  config: MarkdownMcpConfig,
): void {
  server.tool(
    "md_search",
    "Full-text or regex search across the file, returning matching lines with surrounding context",
    searchInputShape,
    async (input) => {
      const resp = await handleSearch(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );
}
