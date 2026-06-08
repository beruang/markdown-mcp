import { z } from "zod";

// ── Error codes ──────────────────────────────────────────────────────────

export type ErrorCode =
  | "FILE_NOT_FOUND"
  | "SECTION_NOT_FOUND"
  | "AMBIGUOUS_HEADING"
  | "INVALID_LINE_RANGE"
  | "PARSE_ERROR"
  | "WRITE_ERROR"
  | "INVALID_INPUT";

// ── Response envelope ────────────────────────────────────────────────────

export interface DiffResult {
  start_line: number;
  end_line: number;
  before: string;
  after: string;
}

export interface McpResponse<T = Record<string, unknown>> {
  file: string;
  operation: string;
  start_line?: number;
  end_line?: number;
  content?: string;
  diff?: DiffResult;
  metadata?: T;
  error?: string;
  error_code?: ErrorCode;
}

// ── Domain types ─────────────────────────────────────────────────────────

export interface HeadingEntry {
  level: number;
  text: string;
  anchor: string;
  line: number;
  end_line: number;
}

export interface FileInfo {
  total_lines: number;
  word_count: number;
  char_count: number;
  section_count: number;
  max_heading_depth: number;
  has_frontmatter: boolean;
  frontmatter_keys: string[];
  last_modified: string;
  size_bytes: number;
  top_level_sections: string[];
  [key: string]: unknown;
}

export interface MarkdownMcpConfig {
  allowed_extensions: string[];
  max_file_size_kb: number;
  read_only: boolean;
}

export interface SectionBounds {
  start: number;
  end: number;
}

export interface FrontmatterResult {
  format: "yaml" | "toml" | "none";
  raw: string;
  parsed: Record<string, unknown>;
  startLine: number;
  endLine: number;
}

// ── Zod schemas (raw shapes for MCP SDK compatibility) ───────────────────

const fileSchema = z.string().min(1, "file path is required");

// Read tools
export const outlineInputShape = {
  file: fileSchema,
  max_depth: z.number().int().min(1).max(6).optional(),
};

export const sectionInputShape = {
  file: fileSchema,
  heading: z.string().min(1),
  include_children: z.boolean().optional(),
  include_heading: z.boolean().optional(),
};

export const linesInputShape = {
  file: fileSchema,
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
};

export const frontmatterInputShape = {
  file: fileSchema,
  keys: z.array(z.string()).optional(),
};

// Search
export const searchInputShape = {
  file: fileSchema,
  query: z.string().min(1),
  is_regex: z.boolean().optional(),
  case_sensitive: z.boolean().optional(),
  context_lines: z.number().int().min(0).optional(),
  max_results: z.number().int().min(1).optional(),
  section: z.string().optional(),
};

// Write
export const upsertSectionInputShape = {
  file: fileSchema,
  heading: z.string().min(1),
  content: z.string(),
  heading_level: z.number().int().min(1).max(6).optional(),
  insert_after: z.string().optional(),
  insert_position: z.enum(["start", "end"]).optional(),
  dry_run: z.boolean().optional(),
};

export const appendSectionInputShape = {
  file: fileSchema,
  heading: z.string().min(1),
  content: z.string(),
  dry_run: z.boolean().optional(),
};

export const insertAtLineInputShape = {
  file: fileSchema,
  line: z.number().int().min(1),
  content: z.string(),
  dry_run: z.boolean().optional(),
};

export const replaceTextInputShape = {
  file: fileSchema,
  find: z.string().min(1),
  replace: z.string(),
  is_regex: z.boolean().optional(),
  case_sensitive: z.boolean().optional(),
  scope_section: z.string().optional(),
  replace_all: z.boolean().optional(),
  dry_run: z.boolean().optional(),
};

export const setFrontmatterInputShape = {
  file: fileSchema,
  updates: z.record(z.unknown()),
  remove_keys: z.array(z.string()).optional(),
  dry_run: z.boolean().optional(),
};

export const deleteSectionInputShape = {
  file: fileSchema,
  heading: z.string().min(1),
  include_children: z.boolean().optional(),
  dry_run: z.boolean().optional(),
};

// Meta
export const fileInfoInputShape = {
  file: fileSchema,
};

export const listFilesInputShape = {
  directory: z.string().min(1),
  recursive: z.boolean().optional(),
  pattern: z.string().optional(),
  include_info: z.boolean().optional(),
};
