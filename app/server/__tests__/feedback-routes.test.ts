/**
 * Feedback routes: ownership, upsert, categories, clear, clear → re-create
 * keeping the score id, Langfuse failures not failing requests, and feedback
 * in the session history. Auth is stubbed: `x-test-user` is the signed-in user.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono, type Context, type Next } from "hono";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { createFeedbackSync, feedbackScoreId, setFeedbackSyncForTests, type FeedbackSync } from "../observability/feedback-sync";
import { FakeScoreWriter, ids, seedTracedTurn } from "../observability/__tests__/feedback-test-utils";
import type { AppEnv } from "../types";

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));
mock.module("../middleware/clerk", () => ({
  clerkAuth: async (c: Context<AppEnv>, next: Next) => {
    c.set("userId", c.req.header("x-test-user") ?? null);
    await next();
  },
  requireDbUser: async (_c: Context, next: Next) => next(),
  requireUser: async (_c: Context, next: Next) => next(),
}));

const { feedback } = await import("../routes/feedback");
const { sessions } = await import("../routes/sessions");
const app = new Hono<AppEnv>().route("/messages", feedback).route("/sessions", sessions);

seedTracedTurn(q);
const key = { messageId: ids.assistantMessage, userId: ids.user };

let writer: FakeScoreWriter;
let sync: FeedbackSync;

function send(method: "PUT" | "DELETE", messageId: string, user = ids.user, body?: unknown) {
  return app.request(`/messages/${messageId}/feedback`, {
    method,
    headers: { "x-test-user": user, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  t.sqlite.run("DELETE FROM message_feedback");
  writer = new FakeScoreWriter();
  sync = createFeedbackSync({ queries: q.messageFeedbackQueries, writer, environment: "test", sleep: async () => {} });
  setFeedbackSyncForTests(sync);
});

afterAll(() => setFeedbackSyncForTests(null));

describe("feedback routes", () => {
  it("rejects other users, unknown messages, user messages and bad values", async () => {
    expect((await send("PUT", ids.assistantMessage, ids.otherUser, { value: 1 })).status).toBe(403);
    expect((await send("DELETE", ids.assistantMessage, ids.otherUser)).status).toBe(403);
    expect((await send("PUT", "77777777-7777-4777-8777-777777777777", ids.user, { value: 1 })).status).toBe(404);
    expect((await send("PUT", ids.userMessage, ids.user, { value: 1 })).status).toBe(400);
    expect((await send("PUT", ids.assistantMessage, ids.user, { value: 2 })).status).toBe(400);
    expect(q.messageFeedbackQueries.find(key)).toBeNull();
    expect(q.messageFeedbackQueries.find({ ...key, userId: ids.otherUser })).toBeNull();
  });

  it("upserts and returns the feedback, then syncs the score", async () => {
    const res = await send("PUT", ids.assistantMessage, ids.user, { value: 0, comment: "  wrong variant  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feedback: { value: 0, comment: "wrong variant", categories: [] } });
    await sync.idle();
    expect(writer.remote.get(feedbackScoreId(key))).toMatchObject({ traceId: ids.traceId, value: 0, comment: "wrong variant" });
    expect(q.messageFeedbackQueries.find(key)).toMatchObject({ value: 0, revision: 1, sync_pending: 0 });

    await send("PUT", ids.assistantMessage, ids.user, { value: 1 });
    await sync.idle();
    expect(q.messageFeedbackQueries.find(key)).toMatchObject({ value: 1, comment: null, revision: 2, sync_pending: 0 });
    expect(writer.remote.get(feedbackScoreId(key))?.value).toBe(1);
  });

  it("persists categories deduped and sorted, and returns them", async () => {
    const res = await send("PUT", ids.assistantMessage, ids.user, {
      value: 1,
      categories: ["well_sourced", "accurate", "well_sourced"],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feedback: { value: 1, comment: null, categories: ["accurate", "well_sourced"] } });
    expect(q.messageFeedbackQueries.find(key)).toMatchObject({ categories: ["accurate", "well_sourced"], revision: 1 });

    // Changing only the categories is a write like any other (revision bump → re-sync).
    await send("PUT", ids.assistantMessage, ids.user, { value: 1, categories: ["clear"] });
    await sync.idle();
    expect(q.messageFeedbackQueries.find(key)).toMatchObject({ categories: ["clear"], revision: 2, synced_revision: 2 });

    // Omitted categories default to [] (a thumb click never keeps old ones).
    await send("PUT", ids.assistantMessage, ids.user, { value: 0 });
    expect(q.messageFeedbackQueries.find(key)).toMatchObject({ value: 0, categories: [] });
  });

  it("rejects categories of the other polarity, unknown ids and more than 5", async () => {
    const status = async (body: unknown) => (await send("PUT", ids.assistantMessage, ids.user, body)).status;
    expect(await status({ value: 1, categories: ["accurate", "wrong_citation"] })).toBe(400);
    expect(await status({ value: 0, categories: ["accurate"] })).toBe(400);
    expect(await status({ value: 1, categories: ["not_a_category"] })).toBe(400);
    expect(await status({ value: 1, categories: ["accurate", "accurate", "clear", "clear", "accurate", "clear"] })).toBe(400);
    expect(q.messageFeedbackQueries.find(key)).toBeNull();
  });

  it("clears to a tombstone and deletes the score", async () => {
    await send("PUT", ids.assistantMessage, ids.user, { value: 0, categories: ["outdated"] });
    const res = await send("DELETE", ids.assistantMessage);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feedback: null });
    await sync.idle();
    expect(q.messageFeedbackQueries.find(key)).toMatchObject({ value: null, categories: [], revision: 2, sync_pending: 0 });
    expect(writer.remote.has(feedbackScoreId(key))).toBe(false);
    expect([...writer.remote.values()].map((s) => s.value)).toEqual(Array(10).fill(0)); // category scores stay, as false
    // Clearing again (or without feedback) writes nothing.
    expect((await send("DELETE", ids.assistantMessage)).status).toBe(200);
    expect(q.messageFeedbackQueries.find(key)?.revision).toBe(2);
  });

  it("clear → re-create keeps the row and the score id", async () => {
    await send("PUT", ids.assistantMessage, ids.user, { value: 0 });
    const first = q.messageFeedbackQueries.find(key)!;
    await send("DELETE", ids.assistantMessage);
    await send("PUT", ids.assistantMessage, ids.user, { value: 1 });
    await sync.idle();
    expect(q.messageFeedbackQueries.find(key)).toMatchObject({ id: first.id, value: 1, revision: 3, sync_pending: 0 });
    const main = writer.log.filter((c) => c.id === feedbackScoreId(key));
    expect(main.map((c) => c.op)).toEqual(["upsert", "remove", "exists", "upsert"]);
    expect(main.filter((c) => c.op === "upsert").map((c) => c.value)).toEqual([0, 1]);
    expect(writer.remote.get(feedbackScoreId(key))?.value).toBe(1);
  });

  it("succeeds when Langfuse is unreachable; the row stays pending", async () => {
    writer.failNext.push(new TypeError("fetch failed"));
    const res = await send("PUT", ids.assistantMessage, ids.user, { value: 1 });
    expect(res.status).toBe(200);
    await sync.idle();
    expect(q.messageFeedbackQueries.find(key)).toMatchObject({ sync_pending: 1, synced_revision: null });
  });

  it("returns the user's own non-cleared feedback in the session history", async () => {
    await send("PUT", ids.assistantMessage, ids.user, { value: 0, comment: "too long", categories: ["incomplete"] });
    q.messageFeedbackQueries.upsert({ ...key, userId: ids.otherUser }, 1, null);
    const history = async () => {
      const res = await app.request(`/sessions/${ids.session}`, { headers: { "x-test-user": ids.user } });
      return ((await res.json()) as { messages: { id: string; feedback?: unknown }[] }).messages;
    };
    const messages = await history();
    expect(messages.find((m) => m.id === ids.assistantMessage)?.feedback).toEqual({ value: 0, comment: "too long", categories: ["incomplete"] });
    expect(messages.find((m) => m.id === ids.userMessage)).not.toHaveProperty("feedback");
    expect(JSON.stringify(messages)).not.toContain(ids.traceId);

    await send("DELETE", ids.assistantMessage);
    expect((await history()).find((m) => m.id === ids.assistantMessage)?.feedback).toBeNull();
  });
});
