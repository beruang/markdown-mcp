import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MarkdownMcpConfig, McpResponse } from "../types.js";
import { fileInfoInputShape, listFilesInputShape } from "../types.js";
import { getFileInfo, listFiles } from "../lib/fs.js";

async function handleFileInfo(
  config: MarkdownMcpConfig,
  input: { file: string },
): Promise<McpResponse> {
  const info = await getFileInfo(config, input.file);

  return {
    file: input.file,
    operation: "file_info",
    metadata: info,
  };
}

async function handleListFiles(
  config: MarkdownMcpConfig,
  input: {
    directory: string;
    recursive?: boolean;
    pattern?: string;
    include_info?: boolean;
  },
): Promise<McpResponse> {
  const recursive = input.recursive ?? false;
  const pattern = input.pattern ?? "**/*.md";
  const includeInfo = input.include_info ?? true;

  const files = await listFiles(config, input.directory, recursive, pattern);

  const fileList = await Promise.all(
    files.map(async (f) => {
      const relativePath = path.relative(process.cwd(), f);
      let info = undefined;
      if (includeInfo) {
        try {
          info = await getFileInfo(config, f);
        } catch {
          // File may be unreadable — skip info
        }
      }
      return {
        path: f,
        relative_path: relativePath,
        info,
      };
    }),
  );

  return {
    operation: "list_files",
    file: input.directory,
    metadata: {
      directory: input.directory,
      total_files: fileList.length,
      files: fileList,
    },
  };
}

export function registerMetaTools(
  server: McpServer,
  config: MarkdownMcpConfig,
): void {
  server.tool(
    "md_file_info",
    "Returns summary statistics about a file without reading its content",
    fileInfoInputShape,
    async (input) => {
      const resp = await handleFileInfo(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );

  server.tool(
    "md_list_files",
    "Lists markdown files in a directory, each with a brief summary",
    listFilesInputShape,
    async (input) => {
      const resp = await handleListFiles(config, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(resp) }] };
    },
  );
}
