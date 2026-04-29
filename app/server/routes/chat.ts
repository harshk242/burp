import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { v4 as uuidv4 } from "uuid";
import { ChatRequestSchema, ErrorSchema } from "../schemas";
import { clerkAuth, requireUser, requireDbUser } from "../middleware/clerk";
import { rateLimitMiddleware } from "../middleware/rateLimit";
import { processChat, generateSessionTitle } from "../orchestration/chat-v2";
import { chatSessionQueries, messageQueries } from "../db";
import { logger } from "../logger";
import { appConfig } from "../config";

import type { AppEnv } from "../types";

const chat = new OpenAPIHono<AppEnv>();

// Apply Clerk auth and user role check to all chat routes
chat.use("*", clerkAuth, requireDbUser, requireUser, rateLimitMiddleware);

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
  const { message, sessionId: providedSessionId } = c.req.valid("json");
  const userId = c.get("userId") as string;

  if (message.length > appConfig.usage.max_chat_input_chars) {
    return c.json(
      {
        error: "message_too_large",
        message: `Message must be ${appConfig.usage.max_chat_input_chars.toLocaleString()} characters or fewer.`,
      },
      400
    );
  }

  // Generate session ID if not provided
  const sessionId = providedSessionId || uuidv4();

  const existingSession = chatSessionQueries.findById(sessionId);
  const canInspectSession = !existingSession || existingSession.user_id === userId;

  const existingMessages = canInspectSession
    ? messageQueries.findByChatId(sessionId)
    : [];
  const firstUserMessage = existingMessages.find((msg) => msg.role === "user" && msg.content)
    ?.content;
  const shouldGenerateTitle =
    canInspectSession &&
    isUntitledSession(existingSession?.title) &&
    (existingMessages.length === 0 || Boolean(firstUserMessage));

  return streamSSE(c, async (stream) => {
    try {
      // Fire title generation in parallel with chat processing.
      // The title only depends on the user's question, not the response,
      // so we don't need to wait for chat completion.
      const titlePromise = shouldGenerateTitle
        ? generateSessionTitle(sessionId, firstUserMessage || message).catch(
            (err) => {
              logger.error("TITLE", "generation_failed_in_route", { error: err instanceof Error ? err : String(err), ctx: { session_id: sessionId } });
              return null;
            }
          )
        : null;

      // Process chat through Claude with tool calling
      for await (const event of processChat(sessionId, userId, message)) {
        await stream.writeSSE({
          event: event.type,
          data: typeof event.data === "string" ? event.data : JSON.stringify(event.data),
        });
      }

      // Emit the title after streaming completes.
      // The API call likely finished long ago; this just awaits the stored result.
      if (titlePromise) {
        const title = await titlePromise;
        if (title) {
          await stream.writeSSE({
            event: "title",
            data: JSON.stringify({ title }),
          });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: errorMsg }),
      });
    }
  });
});

function isUntitledSession(title: string | null | undefined): boolean {
  if (!title) {
    return true;
  }
  return title.trim().toLowerCase() === "new chat";
}

export { chat };
