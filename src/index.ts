#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./lib/fs.js";
import { registerReadTools } from "./tools/read.js";
import { registerSearchTools } from "./tools/search.js";
import { registerWriteTools } from "./tools/write.js";
import { registerMetaTools } from "./tools/meta.js";

async function main() {
  const config = loadConfig();

  const server = new McpServer({
    name: "markdown",
    version: "1.0.0",
  });

  registerReadTools(server, config);
  registerSearchTools(server, config);
  registerWriteTools(server, config);
  registerMetaTools(server, config);

  // SSE transport requires an HTTP server wrapper (Express, etc.).
  // The SSEServerTransport from the SDK is designed as middleware.
  // For a standalone SSE server, create a thin Express wrapper that
  // instantiates SSEServerTransport per connection at GET /sse and
  // routes POST /messages to transport.handlePostMessage.
  //
  // See: https://modelcontextprotocol.io/docs/concepts/transports#server-sent-events-sse
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
