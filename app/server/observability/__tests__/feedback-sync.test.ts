import { beforeEach, describe, expect, it } from "bun:test";
import { createTestDb } from "../../__test-utils__/db";
import { createQueries, type FeedbackKey } from "../../db/queries";
import { feedbackSyncOperations } from "../../db/schema";
import { createFeedbackSync, feedbackScoreId, type FeedbackSyncOptions } from "../feedback-sync";
import { FakeScoreWriter, ids, seedTracedTurn } from "./feedback-test-utils";

const key: FeedbackKey = { messageId: ids.assistantMessage, userId: ids.user };
let q: ReturnType<typeof createQueries>;
let writer: FakeScoreWriter;
let clock: number;
let db: ReturnType<typeof createTestDb>["db"];
const row = () => q.messageFeedbackQueries.find(key)!;
const scoreId = (revision = row().revision) => feedbackScoreId(key, revision);
const mainLog = () => writer.log.filter((c) => c.op === "upsert" && c.id.startsWith("fb-"));
function makeSync(overrides: Partial<FeedbackSyncOptions> = {}) {
  return createFeedbackSync({ queries: q.messageFeedbackQueries, writer, environment: "test", now: () => clock, ...overrides });
}
beforeEach(() => {
  db = createTestDb().db;
  q = createQueries(db);
  seedTracedTurn(q);
  writer = new FakeScoreWriter();
  writer.hold = (op, id) => op === "upsert" && id.startsWith("fb-");
  clock = 1_000_000;
});

describe("feedback durable outbox", () => {
  it("uses stable keys with distinct immutable revision IDs", () => {
    expect(feedbackScoreId(key)).toMatch(/^fb-[0-9a-f]{32}$/);
    expect(feedbackScoreId(key, 1)).not.toBe(feedbackScoreId(key, 2));
    expect(feedbackScoreId({ ...key, userId: ids.otherUser })).not.toBe(feedbackScoreId(key));
  });
  it("increments desired revision on every write and retains the tombstone", () => {
    const first = q.messageFeedbackQueries.upsert(key, 1, null);
    expect(q.messageFeedbackQueries.upsert(key, 0, "wrong gene")).toMatchObject({ id: first.id, revision: 2 });
    expect(q.messageFeedbackQueries.clear(key)).toMatchObject({ revision: 3, value: null, sync_pending: 1, sync_state: "pending" });
  });
  it("writes the traced score and records accepted revision", async () => {
    q.messageFeedbackQueries.upsert(key, 0, "missed the drug");
    expect(await makeSync().sync(key)).toBe("synced");
    expect(writer.remote.get(scoreId())).toMatchObject({ traceId: ids.traceId, value: 0, comment: "missed the drug", metadata: { feedback_revision: 1 } });
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 1, sync_state: "accepted", claim_token: null });
  });
  it("persists failure backoff across sync instances", async () => {
    q.messageFeedbackQueries.upsert(key, 1, null);
    writer.failNext.push(new TypeError("fetch failed"));
    expect(await makeSync().sync(key)).toBe("failed");
    expect(row()).toMatchObject({ sync_pending: 1, synced_revision: null, failures: 1, retry_at: clock + 60_000 });
    await makeSync().reconcile();
    expect(mainLog()).toHaveLength(1);
    clock += 60_000;
    writer.failNext.push(new TypeError("fetch failed"));
    await makeSync().reconcile();
    expect(row().retry_at).toBe(clock + 120_000);
    clock += 120_000;
    await makeSync().reconcile();
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 1 });
  });
  it("coalesces waiting work and acknowledges only the desired revision", async () => {
    writer.mode = "manual";
    const sync = makeSync();
    q.messageFeedbackQueries.upsert(key, 0, null);
    const first = sync.sync(key);
    const held = await writer.nextHeld();
    q.messageFeedbackQueries.upsert(key, 1, null);
    const second = sync.sync(key);
    q.messageFeedbackQueries.upsert(key, 0, null);
    expect(sync.sync(key)).toBe(second);
    held.resolve();
    expect(await first).toBe("pending");
    expect(row()).toMatchObject({ sync_pending: 1, synced_revision: 1 });
    (await writer.nextHeld()).resolve();
    expect(await second).toBe("synced");
    expect(mainLog().map((c) => c.value)).toEqual([0, 0]);
    expect(writer.remote.get(scoreId())?.value).toBe(0);
  });
  it("a deferred clear delete cannot erase replacement feedback after both pushes settle", async () => {
    const sync = makeSync();
    q.messageFeedbackQueries.upsert(key, 0, null);
    await sync.sync(key);
    const original = scoreId();
    writer.deferDeletes = true;
    q.messageFeedbackQueries.clear(key);
    expect(await sync.sync(key)).toBe("synced");
    q.messageFeedbackQueries.upsert(key, 1, "replacement");
    expect(await sync.sync(key)).toBe("synced");
    const replacement = scoreId();
    expect(writer.remote.has(original)).toBe(true);
    writer.landDeletes();
    expect(writer.remote.has(original)).toBe(false);
    expect(writer.remote.get(replacement)?.value).toBe(1);
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 3 });
    expect(writer.log.some((c) => c.op === "exists")).toBe(false);
  });
  it("durably claims a key across separate instances", async () => {
    writer.mode = "manual";
    q.messageFeedbackQueries.upsert(key, 0, null);
    const first = makeSync().sync(key);
    const held = await writer.nextHeld();
    const token = row().claim_token;
    q.messageFeedbackQueries.upsert(key, 1, null);
    expect(await makeSync().sync(key)).toBe("pending");
    expect(row().claim_token).toBe(token);
    expect(mainLog()).toHaveLength(1);
    held.resolve();
    expect(await first).toBe("pending");
    writer.mode = "auto";
    expect(await makeSync().sync(key)).toBe("synced");
    expect(writer.remote.get(scoreId())?.value).toBe(1);
  });
  it("fences an expired owner and confirms cleanup of late old writes once", async () => {
    writer.mode = "manual";
    q.messageFeedbackQueries.upsert(key, 0, null);
    const old = makeSync().sync(key);
    const held = await writer.nextHeld();
    q.messageFeedbackQueries.upsert(key, 1, null);
    clock += 60_001;
    writer.mode = "auto";
    expect(await makeSync().sync(key)).toBe("synced");
    held.resolve();
    expect(await old).toBe("pending");
    expect(row()).toMatchObject({ synced_revision: 2, sync_pending: 0 });
    expect(writer.remote.has(scoreId(1))).toBe(true);
    clock += 300_000;
    await makeSync().reconcile();
    expect(writer.remote.has(scoreId(1))).toBe(false);
    expect(writer.remote.get(scoreId(2))?.value).toBe(1);
    q.messageFeedbackQueries.advanceCleanup(row().id, 1, clock + 300_000);
    expect(db.select().from(feedbackSyncOperations).all().find((op) => op.revision === 1)?.state).toBe("cleaned");
    expect(q.messageFeedbackQueries.findPending()).toEqual([]);
    const removes = writer.log.filter((op) => op.op === "remove").length;
    clock += 300_000;
    await makeSync().reconcile();
    expect(writer.log.filter((op) => op.op === "remove")).toHaveLength(removes);
  });
  it("failed cleanup preserves its lifecycle state and retries with durable backoff", async () => {
    const sync = makeSync();
    q.messageFeedbackQueries.upsert(key, 0, null);
    await sync.sync(key);
    q.messageFeedbackQueries.upsert(key, 1, null);
    await sync.sync(key);
    expect(db.select().from(feedbackSyncOperations).all().find((op) => op.revision === 1)?.state).toBe("confirmation_pending");
    clock += 300_000;
    writer.failWhen = (op, id) => op === "remove" && id === scoreId(1) ? new Error("delete unavailable") : null;
    await sync.reconcile();
    expect(row()).toMatchObject({ failures: 1, retry_at: clock + 60_000 });
    expect(db.select().from(feedbackSyncOperations).all().find((op) => op.revision === 1)?.state).toBe("confirmation_pending");
    const removes = writer.log.filter((op) => op.op === "remove").length;
    await makeSync().reconcile();
    expect(writer.log.filter((op) => op.op === "remove")).toHaveLength(removes);
    clock += 60_000;
    await makeSync().reconcile();
    expect(row()).toMatchObject({ failures: 2, retry_at: clock + 120_000 });
    writer.failWhen = null;
    clock += 120_000;
    await makeSync().reconcile();
    expect(db.select().from(feedbackSyncOperations).all().find((op) => op.revision === 1)?.state).toBe("cleaned");
    expect(q.messageFeedbackQueries.findPending()).toEqual([]);
  });
  it("reclaims a crashed worker without losing its durable operation", async () => {
    q.messageFeedbackQueries.upsert(key, 1, null);
    expect(q.messageFeedbackQueries.claim(key, "crashed", clock, 60_000)).not.toBeNull();
    expect(await makeSync().sync(key)).toBe("pending");
    clock += 60_001;
    expect(await makeSync().sync(key)).toBe("synced");
    expect(q.messageFeedbackQueries.acknowledge(key, "crashed", 1)).toBe(false);
  });
  it("does not apply an older operation's retry delay to a newer desired revision", () => {
    q.messageFeedbackQueries.upsert(key, 0, null);
    q.messageFeedbackQueries.claim(key, "old", clock, 60_000);
    q.messageFeedbackQueries.upsert(key, 1, null);
    q.messageFeedbackQueries.release(key, "old", 1, clock + 60_000, 1);
    expect(row()).toMatchObject({ revision: 2, retry_at: 0, failures: 0, claim_token: null });
  });
  it("marks untraced feedback accepted without remote requests", async () => {
    q = createQueries(createTestDb().db);
    seedTracedTurn(q, null);
    q.messageFeedbackQueries.upsert(key, 1, null);
    expect(await makeSync().sync(key)).toBe("synced");
    expect(writer.log).toEqual([]);
  });
});
