/**
 * Minimal stdio MCP server for manager tests. Exits immediately while the file
 * named by FLAKY_FAIL_MARKER exists, so a test can make it fail, then recover.
 */
import { existsSync } from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const marker = process.env.FLAKY_FAIL_MARKER;
if (marker && existsSync(marker)) process.exit(1);

const server = new McpServer({ name: "flaky", version: "1.0.0" });
server.registerTool(
  "demo__frobnicate_widgets",
  { description: "Frobnicate widgets for recovery tests" },
  async () => ({ content: [{ type: "text", text: "ok" }] })
);
await server.connect(new StdioServerTransport());
