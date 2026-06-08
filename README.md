# markdown-mcp

MCP server that gives AI agents surgical, context-efficient access to markdown files. Instead of loading entire files into context, agents use targeted tools to read sections, search content, and apply precise edits — keeping token usage minimal even for 1,000+ line files.

## Design Philosophy

- **Outline-first** — always call `md_get_outline` before reading content. It returns a full document map at minimal token cost.
- **Section-addressed** — prefer heading-based targeting over raw line numbers. Headings are stable; line numbers drift.
- **AST-backed** — all operations use a proper markdown AST (via `remark`), not regex. Code blocks containing `#` are correctly ignored.
- **Diff-aware responses** — write operations return only the changed lines, not the full file.
- **Atomic section updates** — section writes are scoped heading-to-next-sibling. Surrounding sections are untouched.

## Installation

```bash
git clone <repo-url> markdown-mcp
cd markdown-mcp
npm install
npm run build
```

The build outputs to `dist/`. The server entry point is `dist/index.js`.

## Configuration

Configuration is loaded from three sources, in order of precedence:

| Priority | Source | Example |
|---|---|---|
| 1 (highest) | Environment variables | `MARKDOWN_READ_ONLY=true` |
| 2 | `markdown.config.json` (in the working directory) | `{"max_file_size_kb": 2048}` |
| 3 (lowest) | Built-in defaults | `max_file_size_kb: 5120` |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `MARKDOWN_ALLOWED_EXTENSIONS` | `.md,.mdx` | Comma-separated list of allowed file extensions. |
| `MARKDOWN_MAX_FILE_SIZE_KB` | `5120` | Refuse to operate on files larger than this (5 MB default). |
| `MARKDOWN_READ_ONLY` | `false` | Set to `true` to disable all write tools. |
| `MARKDOWN_TRANSPORT` | `stdio` | Transport mode. Set to `sse` for HTTP-based transport (requires Express wrapper). |
| `PORT` | `3000` | Port for SSE transport. |

### Config file

Place `markdown.config.json` in your root directory:

```json
{
  "allowed_extensions": [".md", ".mdx", ".markdown"],
  "max_file_size_kb": 2048,
  "read_only": false
}
```

### Path handling

Both absolute and relative paths are accepted. Relative paths resolve against the current working directory. Only files matching `allowed_extensions` (`.md`, `.mdx` by default) are accessible — providing a basic guardrail against operating on unintended file types.

## Usage

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "markdown": {
      "command": "node",
      "args": ["/path/to/markdown-mcp/dist/index.js"]
    }
  }
}
```

### Any MCP client (stdio)

```bash
node dist/index.js
```

The server speaks the MCP protocol over stdin/stdout. Send JSON-RPC messages to stdin; responses come back on stdout.

### SSE transport

```bash
MARKDOWN_TRANSPORT=sse PORT=3000 node dist/index.js
```

Exposes `GET /sse` for server-to-client streaming and `POST /messages` for client-to-server requests.

## Tools Reference

### Read (4 tools)

| Tool | Description | Key Inputs |
|---|---|---|
| `md_get_outline` | All headings with levels and line numbers. **Call this first.** | `file`, `max_depth?` |
| `md_get_section` | Content of a specific section by heading text or anchor slug. | `file`, `heading`, `include_children?` |
| `md_get_lines` | Arbitrary line range. Use when line numbers are known from a prior call. | `file`, `start_line`, `end_line` |
| `md_get_frontmatter` | YAML or TOML frontmatter block only. Minimal token cost. | `file`, `keys?` |

### Search (1 tool)

| Tool | Description | Key Inputs |
|---|---|---|
| `md_search` | Full-text or regex search with surrounding context lines and section scoping. | `file`, `query`, `is_regex?`, `context_lines?`, `section?` |

### Write (6 tools)

All write tools support `dry_run: true` to preview changes without applying. Responses include a `diff` showing exact before/after.

| Tool | Description | Key Inputs |
|---|---|---|
| `md_upsert_section` | Insert a new section or replace an existing one by heading. **Primary write tool.** | `file`, `heading`, `content`, `heading_level?`, `insert_after?` |
| `md_append_to_section` | Append content to the end of a section. | `file`, `heading`, `content` |
| `md_insert_at_line` | Insert content at a specific line number. | `file`, `line`, `content` |
| `md_replace_text` | Find-and-replace text or regex, optionally scoped to a section. | `file`, `find`, `replace`, `is_regex?`, `scope_section?` |
| `md_set_frontmatter` | Update or insert frontmatter keys without touching the document body. | `file`, `updates`, `remove_keys?` |
| `md_delete_section` | Remove a heading and its entire content block. | `file`, `heading`, `include_children?` |

### Meta (2 tools)

| Tool | Description | Key Inputs |
|---|---|---|
| `md_file_info` | File statistics: line count, word count, section count, frontmatter keys, last modified. | `file` |
| `md_list_files` | List markdown files in a directory with optional per-file info. | `directory`, `recursive?`, `pattern?`, `include_info?` |

## Recommended Agent Workflow

### Reading and editing a document

```
1. md_file_info        → Check file size, section count, decide approach
2. md_get_outline      → Get full document map (headings + line ranges)
3. md_get_section      → Read only the relevant section(s)
4. md_upsert_section   → Write changes back surgically
```

### Search-and-edit

```
1. md_search           → Find relevant lines + section context
2. md_get_section      → Read the identified section fully
3. md_replace_text     → Apply targeted text replacement
```

## Response Envelope

Every tool returns a consistent JSON envelope:

```jsonc
{
  "file": "docs/architecture.md",
  "operation": "get_section",
  "start_line": 52,       // 1-indexed, inclusive
  "end_line": 90,
  "content": "...",       // Returned markdown (read ops)
  "diff": {               // Before/after (write ops)
    "start_line": 52,
    "end_line": 90,
    "before": "...",
    "after": "..."
  },
  "metadata": {},         // Op-specific data
  "error": null,          // Present only on failure
  "error_code": null
}
```

## Error Codes

| Code | Description |
|---|---|
| `FILE_NOT_FOUND` | File path does not exist or is not accessible |
| `SECTION_NOT_FOUND` | Heading not found in document |
| `AMBIGUOUS_HEADING` | Multiple sections match the given heading |
| `INVALID_LINE_RANGE` | `start_line` or `end_line` out of bounds |
| `PARSE_ERROR` | File could not be parsed as markdown or frontmatter |
| `WRITE_ERROR` | File system write failed |
| `INVALID_INPUT` | Input schema validation failed or path traversal detected |

## Development

### Scripts

```bash
npm run build       # Compile TypeScript to dist/
npm run dev         # Watch mode — recompile on changes
npm test            # Run all tests once
npm run test:watch  # Run tests in watch mode
npm start           # Start the server (after build)
```

### Project structure

```
src/
├── index.ts              # MCP server entry point & tool registration
├── types.ts              # Shared TypeScript interfaces + Zod schemas
├── lib/
│   ├── parser.ts         # remark AST helpers (parse, stringify, headings)
│   ├── sections.ts       # Section boundary resolution
│   ├── frontmatter.ts    # YAML/TOML frontmatter parsing
│   └── fs.ts             # File I/O, path resolution, config loading
├── tools/
│   ├── read.ts           # md_get_outline, md_get_section, md_get_lines, md_get_frontmatter
│   ├── search.ts         # md_search
│   ├── write.ts          # md_upsert_section, md_append_to_section, md_insert_at_line,
│   │                     # md_replace_text, md_set_frontmatter, md_delete_section
│   └── meta.ts           # md_file_info, md_list_files
└── __tests__/
    ├── helpers.ts        # Temp directory fixtures, config builder
    ├── lib/
    │   ├── parser.test.ts
    │   ├── sections.test.ts
    │   └── frontmatter.test.ts
    └── tools/
        ├── read.test.ts
        └── write.test.ts
```

### Testing

Tests use `vitest` with temp directory fixtures for tool tests and pure function calls for lib tests. No mocking — real filesystem and real remark AST parsing.

```bash
npm test              # 49 tests across 5 files
```

Key test coverage areas:
- Empty files, files with no headings, code blocks containing `#`
- Duplicate heading names (ambiguous match)
- YAML and TOML frontmatter (including malformed)
- Section boundary resolution with nesting
- Write operations: insert, replace, delete, append, dry_run
- Path traversal rejection

## Architecture

### Concurrency

- **stdio transport**: Requests are sequential (MCP guarantee). No concurrency concerns.
- **SSE transport**: A per-file mutex (`Map<string, Promise>`) serializes writes to the same file. Writes to different files do not block each other.
- **Atomic writes**: Content is written to a temp file, then `fs.rename` (POSIX atomic) replaces the target. Readers see either old or new content, never partial.

### AST parsing

All markdown operations use `remark-parse` (part of the `unified` ecosystem) to produce a full `mdast` tree. Section boundaries are determined from AST node positions, not regex — code blocks, HTML comments, and other edge cases where `#` appears are handled correctly.

Frontmatter is handled standalone (without the full AST pipeline) using `js-yaml` and `toml` for efficiency on simple key-value updates.

## License

MIT
