import { expect, it } from "bun:test";
import { openDatabase, createDrizzle } from "../../db/connection";
import { applyPendingMigrations, loadMigrations } from "../../db/executor";
import { MIGRATIONS_FOLDER } from "../../db/paths";
import { createQueries } from "../../db/queries";
import { ids, FakeScoreWriter } from "./feedback-test-utils";
import { createFeedbackSync, feedbackScoreId } from "../feedback-sync";

it("migrates legacy deletion uncertainty into durable cleanup and republishes desired feedback", async () => {
  const sqlite = openDatabase(":memory:");
  try {
    const migrations = loadMigrations(MIGRATIONS_FOLDER);
    const last = migrations.findIndex((m) => m.tag === "0015_feedback_sync_outbox");
    sqlite.transaction(() => applyPendingMigrations(sqlite, migrations.slice(0, last)))();
    const q = createQueries(createDrizzle(sqlite));
    q.userQueries.create(ids.user, "clerk-1", "one@example.com", "One", null, "user", null, null);
    q.chatSessionQueries.create(ids.session, ids.user, "Chat");
    q.messageQueries.create(ids.userMessage, ids.session, "user", "question", null);
    q.messageQueries.create(ids.assistantMessage, ids.session, "assistant", "answer", null);
    sqlite.run("INSERT INTO chat_turns (id, session_id, user_message_id, assistant_message_id, status, trace_id) VALUES (?, ?, ?, ?, 'ok', ?)",
      [ids.turn, ids.session, ids.userMessage, ids.assistantMessage, ids.traceId]);
    sqlite.run(`INSERT INTO message_feedback (id, message_id, user_id, value, revision, sync_pending, synced_revision, delete_unconfirmed)
      VALUES (?, ?, ?, 1, 7, 0, 7, 1)`, ["legacy", ids.assistantMessage, ids.user]);
    sqlite.transaction(() => applyPendingMigrations(sqlite, migrations))();
    const key = { messageId: ids.assistantMessage, userId: ids.user };
    expect(q.messageFeedbackQueries.find(key)).toMatchObject({ revision: 7, value: 1, sync_pending: 1, sync_state: "pending" });
    expect(sqlite.query("SELECT revision, state FROM feedback_sync_operations").all()).toEqual([{ revision: 0, state: "retired" }]);
    const writer = new FakeScoreWriter();
    writer.deferDeletes = true;
    let clock = 1_000_000;
    const sync = createFeedbackSync({ queries: q.messageFeedbackQueries, writer, environment: "test", now: () => clock });
    expect(await sync.sync(key)).toBe("synced");
    expect(writer.log.some((op) => op.op === "remove" && op.id === feedbackScoreId(key))).toBe(true);
    writer.landDeletes();
    expect(writer.remote.get(feedbackScoreId(key, 7))?.value).toBe(1);
    expect(sqlite.query("SELECT state FROM feedback_sync_operations WHERE revision = 0").get()).toEqual({ state: "confirmation_pending" });
    clock += 300_000;
    await sync.reconcile();
    expect(sqlite.query("SELECT state FROM feedback_sync_operations WHERE revision = 0").get()).toEqual({ state: "cleaned" });
    expect(q.messageFeedbackQueries.findPending()).toEqual([]);
    const removes = writer.log.filter((op) => op.op === "remove").length;
    clock += 300_000;
    await sync.reconcile();
    expect(writer.log.filter((op) => op.op === "remove")).toHaveLength(removes);
  } finally { sqlite.close(); }
});
