import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

const chat = new Hono();

// POST /api/chat - Chat with SSE streaming
chat.post("/", async (c) => {
  // TODO: Implement full chat orchestration in Phase 3

  const body = await c.req.json();
  const { message, sessionId } = body;

  if (!message) {
    return c.json({ error: "Message is required" }, 400);
  }

  // For now, return a simple SSE response
  return streamSSE(c, async (stream) => {
    // Send initial event
    await stream.writeSSE({
      event: "start",
      data: JSON.stringify({ sessionId }),
    });

    // Placeholder response
    const response =
      "Chat orchestration with MCP tools will be implemented in Phase 3. " +
      "This will include: LLM integration, tool calling, and streaming responses.";

    // Stream the response word by word (demo)
    const words = response.split(" ");
    for (const word of words) {
      await stream.writeSSE({
        event: "text",
        data: word + " ",
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Send completion event
    await stream.writeSSE({
      event: "done",
      data: JSON.stringify({ message: "Complete" }),
    });
  });
});

export { chat };
