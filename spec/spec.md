# MCP Server: `markdown`

**Version:** 1.0.0
**Language:** TypeScript
**Transport:** stdio (default) | SSE
**Protocol:** Model Context Protocol (MCP) 1.0
**Core Dependencies:** `@modelcontextprotocol/sdk`, `unified`, `remark-parse`, `remark-stringify`, `unist-util-visit`, `mdast`

---

## Overview

`markdown` is an MCP server that gives AI agents surgical, context-efficient access to markdown files. Instead of loading entire files into context, agents use targeted tools to read sections, search content, and apply precise edits — keeping token usage minimal even for 1,000+ line files.

### Design Philosophy

- **Outline-first** — agents should always call `md_get_outline` before reading content
- **Section-addressed** — prefer heading-based targeting over raw line numbers
- **AST-backed** — all operations use a proper markdown AST (via `remark`), not regex
- **Diff-aware responses** — write operations return only affected lines, not full file content
- **Atomic section updates** — section writes are heading-to-next-sibling scoped

---

## Project Structure

```
markdown-mcp/
├── src/
│   ├── index.ts              # MCP server entry point & tool registration
│   ├── tools/
│   │   ├── read.ts           # md_get_outline, md_get_section, md_get_lines, md_get_frontmatter
│   │   ├── search.ts         # md_search
│   │   ├── write.ts          # md_upsert_section, md_append_to_section, md_insert_at_line,
│   │   │                     # md_replace_text, md_set_frontmatter, md_delete_section
│   │   └── meta.ts           # md_file_info, md_list_files
│   ├── lib/
│   │   ├── parser.ts         # remark AST helpers (parse, stringify, walk)
│   │   ├── sections.ts       # Section boundary resolution
│   │   ├── frontmatter.ts    # YAML/TOML frontmatter parsing
│   │   └── fs.ts             # File I/O helpers
│   └── types.ts              # Shared TypeScript interfaces
├── package.json
├── tsconfig.json
└── README.md
```

---

## Response Envelope

Every tool returns a consistent JSON envelope:

```typescript
interface McpResponse {
  file: string;           // Absolute or relative file path
  operation: string;      // Tool name (e.g. "get_section")
  start_line?: number;    // 1-indexed, inclusive
  end_line?: number;      // 1-indexed, inclusive
  content?: string;       // Returned markdown content (read ops)
  diff?: DiffResult;      // Before/after for write ops
  metadata?: Record<string, unknown>; // Extra op-specific data
  error?: string;         // Present only on failure
}

interface DiffResult {
  start_line: number;
  end_line: number;
  before: string;
  after: string;
}
```

---

## Tools Reference

### Category 1 — Read

---

#### `md_get_outline`

Returns all headings in the file with their levels and line numbers. This is the recommended first call — it gives the agent a full "map" of the document at minimal token cost.

**Input Schema:**

```typescript
{
  file: string;           // Path to the markdown file
  max_depth?: number;     // Max heading depth to include (1–6, default: 6)
}
```

**Output:**

```typescript
{
  file: string;
  operation: "get_outline";
  metadata: {
    total_lines: number;
    heading_count: number;
    headings: Array<{
      level: number;       // 1–6
      text: string;        // Heading text (plain, no markdown)
      anchor: string;      // GitHub-style anchor slug
      line: number;        // 1-indexed line number
      end_line: number;    // Last line of this section's content
    }>;
  };
}
```

**Example:**

```json
{
  "file": "docs/architecture.md",
  "operation": "get_outline",
  "metadata": {
    "total_lines": 1240,
    "heading_count": 18,
    "headings": [
      { "level": 1, "text": "Architecture Overview", "anchor": "architecture-overview", "line": 1, "end_line": 48 },
      { "level": 2, "text": "Storage Design", "anchor": "storage-design", "line": 49, "end_line": 198 },
      { "level": 3, "text": "In-Memory Cache", "anchor": "in-memory-cache", "line": 52, "end_line": 90 }
    ]
  }
}
```

---

#### `md_get_section`

Returns the content of a specific section identified by heading text or anchor slug.

**Input Schema:**

```typescript
{
  file: string;
  heading: string;          // Heading text or anchor slug (e.g. "Storage Design" or "storage-design")
  include_children?: boolean; // Include nested subsections (default: true)
  include_heading?: boolean;  // Include the heading line itself (default: true)
}
```

**Output:**

```typescript
{
  file: string;
  operation: "get_section";
  start_line: number;
  end_line: number;
  content: string;
  metadata: {
    heading_level: number;
    heading_text: string;
    child_sections: string[]; // Names of immediate child headings
  };
}
```

**Behavior:**
- If multiple headings match, returns the first match and includes `metadata.ambiguous: true` with alternatives
- Section boundary is heading line to the line before the next heading of equal or higher level
- Returns error if heading not found

---

#### `md_get_lines`

Returns a specific line range from the file.

**Input Schema:**

```typescript
{
  file: string;
  start_line: number;   // 1-indexed, inclusive
  end_line: number;     // 1-indexed, inclusive
}
```

**Output:**

```typescript
{
  file: string;
  operation: "get_lines";
  start_line: number;
  end_line: number;
  content: string;
  metadata: {
    total_lines: number;
    lines_returned: number;
  };
}
```

---

#### `md_get_frontmatter`

Extracts and parses only the YAML or TOML frontmatter block from the file.

Frontmatter is detected by the opening delimiter on line 1:
- `---` → YAML
- `+++` → TOML
- No recognized delimiter on line 1 → `"none"`

The block ends at the next matching closing delimiter (`---` or `+++`).

**Input Schema:**

```typescript
{
  file: string;
  keys?: string[];   // If provided, return only these keys
}
```

**Output:**

```typescript
{
  file: string;
  operation: "get_frontmatter";
  start_line: number;   // Line 1
  end_line: number;     // Last line of frontmatter block
  content: string;      // Raw frontmatter string
  metadata: {
    format: "yaml" | "toml" | "none";
    parsed: Record<string, unknown>; // Parsed key-value pairs
  };
}
```

---

### Category 2 — Search

---

#### `md_search`

Full-text or regex search across the file, returning matching lines with surrounding context.

**Input Schema:**

```typescript
{
  file: string;
  query: string;               // Plain text or regex pattern
  is_regex?: boolean;          // Treat query as regex (default: false)
  case_sensitive?: boolean;    // (default: false)
  context_lines?: number;      // Lines before/after each match (default: 3)
  max_results?: number;        // Cap results (default: 20)
  section?: string;            // Restrict search to a specific section by heading
}
```

**Output:**

```typescript
{
  file: string;
  operation: "search";
  metadata: {
    query: string;
    total_matches: number;
    section_scoped?: string;    // Present only when `section` input was used
    results: Array<{
      line: number;
      content: string;        // The matching line
      context_before: string[]; // Lines before
      context_after: string[];  // Lines after
      section_heading: string;  // Which section this match is in
    }>;
  };
}
```

---

### Category 3 — Write

All write operations:
- Return a `diff` showing exactly what changed
- Accept `dry_run?: boolean` to preview changes without applying
- Are atomic — partial writes do not occur

---

#### `md_upsert_section`

Insert a new section or replace an existing one by heading. This is the primary write tool — the agent never needs to load or understand the full file.

**Input Schema:**

```typescript
{
  file: string;
  heading: string;           // Target heading text or anchor
  content: string;           // Full new section content (excluding the heading line itself)
  heading_level?: number;    // Required if inserting new section (1–6)
  insert_after?: string;     // If inserting new, place after this heading (anchor or text)
  insert_position?: "start" | "end"; // If insert_after not specified (default: "end")
  dry_run?: boolean;
}
```

**Behavior:**
- If heading exists → replaces content from heading line to end of its section
- If heading does not exist → inserts new heading + content at specified position
- Preserves surrounding sections untouched

**Output:**

```typescript
{
  file: string;
  operation: "upsert_section";
  diff: DiffResult;
  metadata: {
    action: "replaced" | "inserted";
    heading: string;
    heading_level: number;
  };
}
```

---

#### `md_append_to_section`

Append content to the end of a section without replacing it.

**Input Schema:**

```typescript
{
  file: string;
  heading: string;     // Target heading text or anchor
  content: string;     // Markdown content to append
  dry_run?: boolean;
}
```

**Output:**

```typescript
{
  file: string;
  operation: "append_to_section";
  diff: DiffResult;
  metadata: {
    heading: string;
    appended_lines: number;
  };
}
```

---

#### `md_insert_at_line`

Insert content at a specific line number. Useful when line numbers are known from a prior `md_get_lines` or search result.

**Input Schema:**

```typescript
{
  file: string;
  line: number;            // 1-indexed; content is inserted BEFORE this line
  content: string;
  dry_run?: boolean;
}
```

**Behavior:**
- If `line > total_lines + 1` → returns `INVALID_LINE_RANGE` error
- If `line == total_lines + 1` → appends content at end of file

**Output:**

```typescript
{
  file: string;
  operation: "insert_at_line";
  diff: DiffResult;
}
```

---

#### `md_replace_text`

Find and replace a text string or regex pattern across the file (or within a section).

**Input Schema:**

```typescript
{
  file: string;
  find: string;                // Plain text or regex pattern
  replace: string;             // Replacement string (supports regex capture groups if is_regex)
  is_regex?: boolean;          // (default: false)
  case_sensitive?: boolean;    // (default: false)
  scope_section?: string;      // Restrict to a section by heading (optional)
  replace_all?: boolean;       // Replace all occurrences (default: true)
  dry_run?: boolean;
}
```

**Output:**

```typescript
{
  file: string;
  operation: "replace_text";
  diff: DiffResult;
  metadata: {
    replacements_made: number;
    lines_affected: number[];
  };
}
```

---

#### `md_set_frontmatter`

Update or insert specific frontmatter keys without touching the document body.

**Input Schema:**

```typescript
{
  file: string;
  updates: Record<string, unknown>;   // Keys to set or update
  remove_keys?: string[];             // Keys to remove
  dry_run?: boolean;
}
```

**Output:**

```typescript
{
  file: string;
  operation: "set_frontmatter";
  diff: DiffResult;
  metadata: {
    keys_updated: string[];
    keys_removed: string[];
    keys_added: string[];
  };
}
```

---

#### `md_delete_section`

Remove a heading and its entire content block.

**Input Schema:**

```typescript
{
  file: string;
  heading: string;             // Target heading text or anchor
  include_children?: boolean;  // Also delete child subsections (default: true)
  dry_run?: boolean;
}
```

**Output:**

```typescript
{
  file: string;
  operation: "delete_section";
  diff: DiffResult;
  metadata: {
    heading: string;
    lines_deleted: number;
    child_sections_deleted: string[];
  };
}
```

---

### Category 4 — Meta

---

#### `md_file_info`

Returns summary statistics about a file without reading its content. Agents should call this to plan their approach before reading.

**Input Schema:**

```typescript
{
  file: string;
}
```

**Output:**

```typescript
{
  file: string;
  operation: "file_info";
  metadata: {
    total_lines: number;
    word_count: number;
    char_count: number;
    section_count: number;
    max_heading_depth: number;
    has_frontmatter: boolean;
    frontmatter_keys: string[];
    last_modified: string;   // ISO 8601
    size_bytes: number;
    top_level_sections: string[];  // H1/H2 heading names only
  };
}
```

---

#### `md_list_files`

Lists markdown files in a directory, each with a brief summary from `md_file_info`.

**Input Schema:**

```typescript
{
  directory: string;
  recursive?: boolean;      // Search subdirectories (default: false)
  pattern?: string;         // Glob pattern filter (default: "**/*.md")
  include_info?: boolean;   // Include md_file_info for each file (default: true)
}
```

**Output:**

```typescript
{
  operation: "list_files";
  metadata: {
    directory: string;
    total_files: number;
    files: Array<{
      path: string;
      relative_path: string;
      info: FileInfo;   // Same shape as md_file_info.metadata
    }>;
  };
}
```

---

## Tool Summary Table

| Tool | Category | Token Cost | Description |
|---|---|---|---|
| `md_get_outline` | Read | Very Low | Headings + line numbers only |
| `md_get_section` | Read | Proportional | One section by heading |
| `md_get_lines` | Read | Proportional | Arbitrary line range |
| `md_get_frontmatter` | Read | Very Low | Frontmatter block only |
| `md_search` | Search | Low–Medium | Full-text / regex search |
| `md_upsert_section` | Write | Low | Insert or replace section |
| `md_append_to_section` | Write | Low | Append to section |
| `md_insert_at_line` | Write | Low | Insert at line number |
| `md_replace_text` | Write | Low | Find and replace |
| `md_set_frontmatter` | Write | Very Low | Update frontmatter keys |
| `md_delete_section` | Write | Very Low | Remove section |
| `md_file_info` | Meta | Very Low | File statistics |
| `md_list_files` | Meta | Low | Directory listing + stats |

---

## Recommended Agent Workflow

```
1. md_file_info        → Check file size, section count, decide approach
2. md_get_outline      → Get full document map (headings + line ranges)
3. md_get_section      → Read only the relevant section(s)
4. md_upsert_section   → Write changes back surgically
```

For search-and-edit tasks:
```
1. md_search           → Find relevant lines + section context
2. md_get_section      → Read the identified section fully
3. md_replace_text     → Apply targeted text replacement
```

---

## Error Handling

All tools return an `error` field on failure instead of throwing. Agents should check for this field.

```typescript
{
  file: "docs/missing.md",
  operation: "get_section",
  error: "FILE_NOT_FOUND: docs/missing.md does not exist",
  error_code: "FILE_NOT_FOUND"
}
```

**Error codes:**

| Code | Description |
|---|---|
| `FILE_NOT_FOUND` | File path does not exist |
| `SECTION_NOT_FOUND` | Heading not found in document |
| `AMBIGUOUS_HEADING` | Multiple sections match the given heading |
| `INVALID_LINE_RANGE` | start_line or end_line out of bounds |
| `PARSE_ERROR` | File could not be parsed as markdown |
| `WRITE_ERROR` | File system write failed |
| `INVALID_INPUT` | Input schema validation failed |

---

## Implementation Notes

### AST Parsing Strategy

Use `remark-parse` to produce a full `mdast` tree. Do NOT use regex for section boundary detection — it fails on edge cases like code blocks containing `#` characters.

```typescript
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkStringify);

const tree = processor.parse(fileContent);
```

### Section Boundary Detection

A section spans from its heading node to the line before the next heading of **equal or lesser depth**:

```typescript
function getSectionBounds(tree: Root, targetHeading: Heading): { start: number; end: number } {
  const headings = selectAll("heading", tree) as Heading[];
  const idx = headings.indexOf(targetHeading);
  const nextSibling = headings.slice(idx + 1).find(h => h.depth <= targetHeading.depth);
  
  const start = targetHeading.position!.start.line;
  const end = nextSibling
    ? nextSibling.position!.start.line - 1
    : getLastLine(tree);
    
  return { start, end };
}
```

### Anchor Slug Generation

Follow GitHub Flavored Markdown anchor rules:

```typescript
function toAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
```

### Line Number Preservation

`remark-parse` provides `position.start.line` / `position.end.line` on every node. Always use these — never count lines manually.

### Concurrency

The server processes requests sequentially over stdio (MCP guarantee). For SSE transport with potential concurrent connections:

- Use a per-file mutex (`Map<string, Promise>`) to serialize writes to the same file
- Write operations are atomic: write content to a temp file, then `fs.rename` (POSIX atomic) to prevent partial writes on crash

### File I/O

- All file paths should resolve relative to a configurable `root` directory passed at server startup
- Support both absolute paths and relative-to-root paths
- Normalize paths to prevent directory traversal (`path.resolve`, check prefix)

---

## Testing Strategy

Tests live in `src/__tests__/` mirroring the source structure:

```
src/__tests__/
├── tools/
│   ├── read.test.ts
│   ├── search.test.ts
│   ├── write.test.ts
│   └── meta.test.ts
└── lib/
    ├── parser.test.ts
    ├── sections.test.ts
    └── frontmatter.test.ts
```

Use `vitest` with a **temp directory fixture** (or `memfs`) to avoid hitting the real filesystem. Each tool test follows this pattern:

1. Write a markdown fixture to the temp directory
2. Call the tool handler
3. Assert the response envelope shape and content

**Critical edge cases to cover:**

| Case | Why |
|---|---|
| Empty file | No headings, no frontmatter — shouldn't crash |
| File with no headings | Outline returns `[]`, section ops return `SECTION_NOT_FOUND` |
| Duplicate heading names | `md_get_section` returns first match + `ambiguous: true` |
| Code blocks with `#` | AST-based parser must NOT treat them as headings |
| Frontmatter at line 1 vs none | `md_get_frontmatter` returns `"none"` when absent |
| File exceeds `max_file_size_kb` | All tools refuse with a clear error |
| `dry_run: true` on write ops | Response includes the diff but file is unchanged on disk |
| Concurrent writes | Mutex serializes; no interleaved corruption |
| Files with no trailing newline | Write ops must not corrupt the last line |

---

## Configuration

Pass configuration via environment variables or a `markdown.config.json` file:

```typescript
interface MarkdownMcpConfig {
  root: string;              // Base directory for file resolution (default: cwd)
  allowed_extensions: string[]; // (default: [".md", ".mdx"])
  max_file_size_kb: number;  // Refuse to operate on files larger than this (default: 5120)
  read_only: boolean;        // Disable all write tools (default: false)
}
```

---

## MCP Server Entry Point Sketch

```typescript
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReadTools } from "./tools/read.js";
import { registerSearchTools } from "./tools/search.js";
import { registerWriteTools } from "./tools/write.js";
import { registerMetaTools } from "./tools/meta.js";

const server = new McpServer({
  name: "markdown",
  version: "1.0.0",
});

registerReadTools(server);
registerSearchTools(server);
registerWriteTools(server);
registerMetaTools(server);

// Default: stdio
const transport = new StdioServerTransport();
await server.connect(transport);
```

### SSE Transport

When `MARKDOWN_TRANSPORT=sse`, use `SSEServerTransport` with an HTTP server:

```typescript
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const transport = new SSEServerTransport({
  port: Number(process.env.PORT) || 3000,
});
await server.connect(transport);
// Exposes GET /sse (server→client) and POST /messages (client→server)
```

---

## package.json (key dependencies)

```json
{
  "name": "markdown-mcp",
  "version": "1.0.0",
  "type": "module",
  "bin": { "markdown-mcp": "./dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "unified": "^11.0.0",
    "remark-parse": "^11.0.0",
    "remark-stringify": "^11.0.0",
    "remark-frontmatter": "^5.0.0",
    "unist-util-visit": "^5.0.0",
    "unist-util-select": "^5.0.0",
    "mdast-util-to-string": "^4.0.0",
    "js-yaml": "^4.1.0",
    "toml": "^3.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest"
  }
}
```

---

## Integration Example (Claude Desktop / pi-mono)

```json
{
  "mcpServers": {
    "markdown": {
      "command": "node",
      "args": ["/path/to/markdown-mcp/dist/index.js"],
      "env": {
        "MARKDOWN_ROOT": "/path/to/your/docs"
      }
    }
  }
}
```

---

*Spec version 1.0.0 — markdown-mcp*
