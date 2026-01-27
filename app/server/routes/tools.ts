import { Hono } from "hono";

const tools = new Hono();

// GET /api/tools - List all available tools
tools.get("/", async (c) => {
  // TODO: Implement in Phase 3 (Gateway) - get tools from MCP registry
  return c.json({
    message: "Tool listing will be implemented in Phase 3",
    tools: [],
  });
});

// GET /api/tools/search - Search tools by name/description
tools.get("/search", async (c) => {
  const query = c.req.query("q");

  // TODO: Implement in Phase 3 (Gateway) - search MCP registry
  return c.json({
    message: "Tool search will be implemented in Phase 3",
    query,
    tools: [],
  });
});

// POST /api/tools/:server/:name - Direct tool call
tools.post("/:server/:name", async (c) => {
  const { server, name } = c.req.param();

  // TODO: Implement in Phase 3 (Gateway) - call MCP tool directly
  return c.json({
    message: "Direct tool calls will be implemented in Phase 3",
    server,
    tool: name,
  });
});

export { tools };
