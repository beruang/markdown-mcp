import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { MarkdownMcpConfig } from "../types.js";

export function setupTempDir(): { dir: string; cleanup: () => Promise<void> } {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "markdown-mcp-test-"));
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export async function createFixture(
  dir: string,
  name: string,
  content: string,
): Promise<string> {
  const filePath = path.join(dir, name);
  const parentDir = path.dirname(filePath);
  await fs.mkdir(parentDir, { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

export function createConfig(
  _root: string,
  overrides?: Partial<MarkdownMcpConfig>,
): MarkdownMcpConfig {
  return {
    allowed_extensions: [".md", ".mdx"],
    max_file_size_kb: 5120,
    read_only: false,
    ...overrides,
  };
}
