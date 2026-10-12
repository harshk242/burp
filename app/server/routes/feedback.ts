import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { chatSessionQueries, messageFeedbackQueries, messageQueries, type DbMessageFeedback } from "../db";
import { clerkAuth, requireDbUser, requireUser } from "../middleware/clerk";
import { requestFeedbackSync } from "../observability/feedback-sync";
import { ErrorSchema, FeedbackRequestSchema, FeedbackResponseSchema } from "../schemas";
import type { AppEnv } from "../types";

/**
 * 👍/👎 on assistant messages. The DB row is written first (the source of
 * truth) and returned; the Langfuse score is synced afterwards
 * (observability/feedback-sync.ts), so Langfuse failures never fail a request.
 */
const feedback = new OpenAPIHono<AppEnv>();

feedback.use("*", clerkAuth, requireDbUser, requireUser);

const params = z.object({
  messageId: z.string().uuid().openapi({ example: "0b6c1f5e-6a1d-4e5b-9d65-0f2a4c8e7a11" }),
});

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});

const errors = {
  400: json("Not an assistant message", ErrorSchema),
  403: json("Forbidden - Not your session", ErrorSchema),
  404: json("Message not found", ErrorSchema),
  500: json("Internal server error", ErrorSchema),
};

type OwnershipCheck = { ok: true } | { ok: false; status: 400 | 403 | 404; error: string };

/** The message exists, is an assistant message, and its session belongs to the user. */
function checkOwnership(messageId: string, userId: string): OwnershipCheck {
  const message = messageQueries.findById(messageId);
  if (!message) return { ok: false, status: 404, error: "Message not found" };
  const session = chatSessionQueries.findById(message.chat_id);
  if (!session) return { ok: false, status: 404, error: "Message not found" };
  if (session.user_id !== userId) return { ok: false, status: 403, error: "Forbidden - Not your session" };
  if (message.role !== "assistant") return { ok: false, status: 400, error: "Feedback is only accepted on assistant messages" };
  return { ok: true };
}

const toResponse = (row: DbMessageFeedback | null) =>
  row && row.value !== null ? { feedback: { value: row.value as 0 | 1, comment: row.comment } } : { feedback: null };

const putFeedbackRoute = createRoute({
  method: "put",
  path: "/{messageId}/feedback",
  tags: ["Sessions"],
  summary: "Set message feedback",
  description: "Thumbs up (1) or down (0) on an assistant message, with an optional comment. Replaces earlier feedback.",
  security: [{ bearerAuth: [] }],
  request: {
    params,
    body: { content: { "application/json": { schema: FeedbackRequestSchema } }, required: true },
  },
  responses: { 200: json("Feedback saved", FeedbackResponseSchema), ...errors },
});

feedback.openapi(putFeedbackRoute, async (c) => {
  const { messageId } = c.req.valid("param");
  const { value, comment } = c.req.valid("json");
  const userId = c.get("userId") as string;
  try {
    const check = checkOwnership(messageId, userId);
    if (!check.ok) return c.json({ error: check.error }, check.status);
    const key = { messageId, userId };
    const row = messageFeedbackQueries.upsert(key, value, comment?.trim() || null);
    requestFeedbackSync(key);
    return c.json(toResponse(row), 200);
  } catch (error) {
    console.error("Error saving feedback:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

const deleteFeedbackRoute = createRoute({
  method: "delete",
  path: "/{messageId}/feedback",
  tags: ["Sessions"],
  summary: "Clear message feedback",
  description: "Removes the user's feedback on an assistant message.",
  security: [{ bearerAuth: [] }],
  request: { params },
  responses: { 200: json("Feedback cleared", FeedbackResponseSchema), ...errors },
});

feedback.openapi(deleteFeedbackRoute, async (c) => {
  const { messageId } = c.req.valid("param");
  const userId = c.get("userId") as string;
  try {
    const check = checkOwnership(messageId, userId);
    if (!check.ok) return c.json({ error: check.error }, check.status);
    const key = { messageId, userId };
    // Clearing feedback that is already cleared (or never given) writes nothing.
    if (messageFeedbackQueries.find(key)?.value != null) {
      messageFeedbackQueries.clear(key);
      requestFeedbackSync(key);
    }
    return c.json({ feedback: null }, 200);
  } catch (error) {
    console.error("Error clearing feedback:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { feedback };
