import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  FileInfo,
  MarkdownMcpConfig,
} from "../types.js";
import { extractHeadings, getLastLine, parseMarkdown } from "./parser.js";
import { extractFrontmatter, hasFrontmatter } from "./frontmatter.js";

// ── Config ────────────────────────────────────────────────────────────────

const DEFAULTS: MarkdownMcpConfig = {
  allowed_extensions: [".md", ".mdx"],
  max_file_size_kb: 5120,
  read_only: false,
};

export function loadConfig(
  overrides?: Partial<MarkdownMcpConfig>,
): MarkdownMcpConfig {
  let config = { ...DEFAULTS };

  // Try loading markdown.config.json from cwd
  try {
    const configPath = path.join(process.cwd(), "markdown.config.json");
    const raw = require(configPath);
    if (raw && typeof raw === "object") {
      config = { ...config, ...raw };
    }
  } catch {
    // Config file not found or invalid — use defaults
  }

  // Environment variables override everything
  if (process.env.MARKDOWN_ALLOWED_EXTENSIONS) {
    config.allowed_extensions =
      process.env.MARKDOWN_ALLOWED_EXTENSIONS.split(",").map((e) =>
        e.trim(),
      );
  }
  if (process.env.MARKDOWN_MAX_FILE_SIZE_KB) {
    config.max_file_size_kb = Number(process.env.MARKDOWN_MAX_FILE_SIZE_KB);
  }
  if (process.env.MARKDOWN_READ_ONLY === "true") {
    config.read_only = true;
  }

  // Apply programmatic overrides (used in tests)
  if (overrides) {
    config = { ...config, ...overrides };
  }

  return config;
}

// ── Path resolution ──────────────────────────────────────────────────────

export function resolvePath(
  _config: MarkdownMcpConfig,
  inputPath: string,
): string {
  return path.resolve(inputPath);
}

// ── Validation ───────────────────────────────────────────────────────────

export function validateExtension(
  config: MarkdownMcpConfig,
  filePath: string,
): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!config.allowed_extensions.includes(ext)) {
    throw Object.assign(
      new Error(
        `Extension "${ext}" not allowed. Allowed: ${config.allowed_extensions.join(", ")}`,
      ),
      { code: "INVALID_INPUT" as const },
    );
  }
}

export async function validateFileSize(
  config: MarkdownMcpConfig,
  filePath: string,
): Promise<void> {
  const stat = await fs.stat(filePath);
  const sizeKb = stat.size / 1024;
  if (sizeKb > config.max_file_size_kb) {
    throw Object.assign(
      new Error(
        `File size ${sizeKb.toFixed(1)}KB exceeds limit of ${config.max_file_size_kb}KB`,
      ),
      { code: "INVALID_INPUT" as const },
    );
  }
}

// ── File I/O ──────────────────────────────────────────────────────────────

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readFile(
  config: MarkdownMcpConfig,
  filePath: string,
): Promise<string> {
  const resolved = resolvePath(config, filePath);
  validateExtension(config, resolved);

  if (!(await fileExists(resolved))) {
    throw Object.assign(new Error(`FILE_NOT_FOUND: ${filePath} does not exist`), {
      code: "FILE_NOT_FOUND" as const,
    });
  }

  await validateFileSize(config, resolved);
  return fs.readFile(resolved, "utf-8");
}

export async function writeFile(
  config: MarkdownMcpConfig,
  filePath: string,
  content: string,
): Promise<void> {
  const resolved = resolvePath(config, filePath);
  // Atomic write: temp file + rename
  const dir = path.dirname(resolved);
  const tmpName = `.${path.basename(resolved)}.tmp.${crypto.randomBytes(8).toString("hex")}`;
  const tmpPath = path.join(dir, tmpName);

  try {
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, resolved);
  } catch (err) {
    // Clean up temp file on failure
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore
    }
    throw Object.assign(
      new Error(`WRITE_ERROR: ${(err as Error).message}`),
      { code: "WRITE_ERROR" as const },
    );
  }
}

// ── Per-file mutex ───────────────────────────────────────────────────────

const fileLocks = new Map<string, Promise<void>>();

export function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = fileLocks.get(filePath) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run fn even if prev rejected
  const cleanup = next
    .then(() => {
      if (fileLocks.get(filePath) === cleanup) {
        fileLocks.delete(filePath);
      }
    })
    .catch(() => {
      if (fileLocks.get(filePath) === cleanup) {
        fileLocks.delete(filePath);
      }
    });
  fileLocks.set(filePath, cleanup);
  return next;
}

// ── File info ─────────────────────────────────────────────────────────────

export async function getFileInfo(
  config: MarkdownMcpConfig,
  filePath: string,
): Promise<FileInfo> {
  const resolved = resolvePath(config, filePath);
  const stat = await fs.stat(resolved);
  const content = await fs.readFile(resolved, "utf-8");

  const lines = content.split("\n");
  const totalLines = lines.length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const charCount = content.length;

  let sectionCount = 0;
  let maxDepth = 0;
  let topLevelSections: string[] = [];

  try {
    const tree = parseMarkdown(content);
    const headings = extractHeadings(tree);
    sectionCount = headings.length;
    maxDepth = headings.reduce((m, h) => Math.max(m, h.level), 0);
    // Ensure we filter by actual H1/H2, not just any top-level
    topLevelSections = headings
      .filter((h) => h.level <= 2)
      .map((h) => h.text);
  } catch {
    // If parsing fails, leave counts at 0
  }

  let fmKeys: string[] = [];
  let hasFm = false;
  try {
    hasFm = hasFrontmatter(content);
    if (hasFm) {
      const fm = extractFrontmatter(content);
      fmKeys = Object.keys(fm.parsed);
    }
  } catch {
    // ignore
  }

  return {
    total_lines: totalLines,
    word_count: wordCount,
    char_count: charCount,
    section_count: sectionCount,
    max_heading_depth: maxDepth,
    has_frontmatter: hasFm,
    frontmatter_keys: fmKeys,
    last_modified: stat.mtime.toISOString(),
    size_bytes: stat.size,
    top_level_sections: topLevelSections,
  };
}

// ── Directory listing ────────────────────────────────────────────────────

export async function listFiles(
  config: MarkdownMcpConfig,
  directory: string,
  recursive: boolean,
  pattern: string,
): Promise<string[]> {
  const dir = resolvePath(config, directory);
  const extPattern = pattern || "**/*.md";

  try {
    // Simple glob using recursive directory walk
    const results: string[] = [];
    await walkDir(dir, recursive ? Infinity : 0, config, results);
    return results
      .filter((f) => {
        const rel = path.relative(dir, f);
        // Simple glob matching
        if (extPattern === "**/*.md") {
          return f.endsWith(".md") || f.endsWith(".mdx");
        }
        return true;
      })
      .sort();
  } catch {
    throw Object.assign(
      new Error(`FILE_NOT_FOUND: Directory ${directory} not accessible`),
      { code: "FILE_NOT_FOUND" as const },
    );
  }
}

async function walkDir(
  dir: string,
  depth: number,
  config: MarkdownMcpConfig,
  results: string[],
): Promise<void> {
  if (depth < 0) return;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(full, depth - 1, config, results);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (config.allowed_extensions.includes(ext)) {
          results.push(full);
        }
      }
    }
  } catch {
    // Skip unreadable directories
  }
}
