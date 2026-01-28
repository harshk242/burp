import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { ChatRequestSchema, ErrorSchema } from "../schemas";
import { clerkAuth, requireUser, requireDbUser } from "../middleware/clerk";

const chat = new OpenAPIHono();

// Apply Clerk auth and user role check to all chat routes
chat.use("*", clerkAuth, requireDbUser, requireUser);

// ============================================
// POST /api/chat - Chat with SSE streaming
// ============================================

const chatRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Chat"],
  summary: "Chat with AI agent",
  description: `Send a message to the AI agent and receive a streaming response via Server-Sent Events (SSE).

The agent can query 10 biomedical databases:
- **UniProt** - Protein sequences and annotations
- **ChEMBL** - Drug compounds and bioactivity data
- **PubChem** - Chemical structures and properties
- **Ensembl** - Genomic data and gene annotations
- **ClinVar** - Clinical variant interpretations
- **Open Targets** - Drug-target associations
- **Reactome** - Biological pathways
- **ClinicalTrials** - Clinical trial information
- **PubMed** - Biomedical literature
- **ClinPGx** - Pharmacogenomics data

**SSE Events:**
- \`start\` - Chat session started
- \`text\` - Text chunk from the assistant
- \`tool_start\` - Tool execution started
- \`tool_end\` - Tool execution completed
- \`done\` - Response complete`,
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: ChatRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "SSE stream of chat response",
      content: {
        "text/event-stream": {
          schema: z.string().openapi({
            example: `event: start
data: {"sessionId":"550e8400-e29b-41d4-a716-446655440000"}

event: text
data: Looking up EGFR in UniProt...

event: tool_start
data: {"tool":"uniprot__search_proteins","input":{"query":"EGFR"}}

event: tool_end
data: {"tool":"uniprot__search_proteins","output":{...}}

event: text
data: Found 5 proteins related to EGFR...

event: done
data: {"message":"Complete"}`,
          }),
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    403: {
      description: "Forbidden - User not approved",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

chat.openapi(chatRoute, async (c) => {
  const { message, sessionId } = c.req.valid("json");
  const userId = c.get("userId") as string;

  // For now, return a simple SSE response
  return streamSSE(c, async (stream) => {
    // Send initial event
    await stream.writeSSE({
      event: "start",
      data: JSON.stringify({ sessionId: sessionId || "new", userId }),
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
