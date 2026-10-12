/**
 * Feedback sync against a real (in-memory) DB and a fake ScoreWriter whose
 * calls the test holds open: acknowledged writes only, per-id ordering,
 * compare-and-set on revision, tombstone confirm reads, reconciliation.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createTestDb } from "../../__test-utils__/db";
import { createQueries, type FeedbackKey } from "../../db/queries";
import { createFeedbackSync, feedbackScoreId, type FeedbackSyncOptions } from "../feedback-sync";
import { ScoreWriteError } from "../score-writer";
import { FakeScoreWriter, ids, seedTracedTurn } from "./feedback-test-utils";

const key: FeedbackKey = { messageId: ids.assistantMessage, userId: ids.user };
const scoreId = feedbackScoreId(key);

let q: ReturnType<typeof createQueries>;
let writer: FakeScoreWriter;
let clock: number;

function makeSync(overrides: Partial<FeedbackSyncOptions> = {}) {
  return createFeedbackSync({
    queries: q.messageFeedbackQueries,
    writer,
    environment: "test",
    sleep: async () => {},
    now: () => clock,
    ...overrides,
  });
}

const row = () => q.messageFeedbackQueries.find(key)!;

beforeEach(() => {
  q = createQueries(createTestDb().db);
  seedTracedTurn(q);
  writer = new FakeScoreWriter();
  clock = 1_000_000;
});

describe("feedback score id", () => {
  it("is stable per (message, user) and differs between users", () => {
    expect(feedbackScoreId(key)).toBe(scoreId);
    expect(scoreId).toMatch(/^fb-[0-9a-f]{32}$/);
    expect(feedbackScoreId({ ...key, userId: ids.otherUser })).not.toBe(scoreId);
  });
});

describe("message_feedback writes", () => {
  it("bumps revision on every write, even two in the same second", () => {
    q.messageFeedbackQueries.upsert(key, 1, null);
    const first = row();
    q.messageFeedbackQueries.upsert(key, 0, "wrong gene");
    const second = row();
    expect(second.updated_at - first.updated_at).toBeLessThanOrEqual(1);
    expect([first.revision, second.revision]).toEqual([1, 2]);
    expect(q.messageFeedbackQueries.clear(key)).toMatchObject({ revision: 3, value: null, comment: null, sync_pending: 1 });
    expect(q.messageFeedbackQueries.upsert(key, 1, null)).toMatchObject({ id: first.id, revision: 4, value: 1 });
  });

  it("markSynced clears sync_pending only when the revision still matches", () => {
    q.messageFeedbackQueries.upsert(key, 1, null);
    q.messageFeedbackQueries.upsert(key, 0, null);
    expect(q.messageFeedbackQueries.markSynced(key, 1)).toBe(false);
    expect(row()).toMatchObject({ sync_pending: 1, synced_revision: 1 });
    expect(q.messageFeedbackQueries.markSynced(key, 2)).toBe(true);
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 2 });
  });
});

describe("feedback sync", () => {
  it("upserts the score on the turn's trace and marks the row synced", async () => {
    q.messageFeedbackQueries.upsert(key, 0, "missed the drug");
    expect(await makeSync().sync(key)).toBe("synced");
    expect(writer.remote.get(scoreId)).toMatchObject({
      id: scoreId,
      traceId: ids.traceId,
      name: "user_feedback",
      value: 0,
      dataType: "NUMERIC",
      environment: "test",
      comment: "missed the drug",
    });
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 1 });
    expect(row().synced_at).not.toBeNull();
  });

  for (const [label, error] of [
    ["a transport failure", new TypeError("fetch failed")],
    ["a 5xx", new ScoreWriteError("POST /api/public/scores failed: HTTP 503", 503)],
  ] as const) {
    it(`leaves the row pending with synced_revision unchanged after ${label}`, async () => {
      const sync = makeSync();
      q.messageFeedbackQueries.upsert(key, 1, null);
      await sync.sync(key);
      q.messageFeedbackQueries.upsert(key, 0, null);
      writer.failNext.push(error);
      expect(await sync.sync(key)).toBe("failed");
      expect(row()).toMatchObject({ revision: 2, sync_pending: 1, synced_revision: 1 });
      expect(writer.remote.get(scoreId)?.value).toBe(1);
    });
  }

  it("create → clear: deletes only after the create resolved; synced only after delete and confirm read", async () => {
    writer.mode = "manual";
    const sync = makeSync();
    q.messageFeedbackQueries.upsert(key, 1, null);
    const createPush = sync.sync(key);
    const create = await writer.nextHeld();
    expect(create.op).toBe("upsert");

    q.messageFeedbackQueries.clear(key);
    const clearPush = sync.sync(key);
    await Bun.sleep(5);
    expect(writer.held).toHaveLength(0); // the delete waits for the create

    create.resolve();
    expect(await createPush).toBe("pending"); // revision moved on during the push
    expect(row()).toMatchObject({ sync_pending: 1, synced_revision: 1 });

    const remove = await writer.nextHeld();
    expect(remove.op).toBe("remove");
    remove.resolve();
    const confirm = await writer.nextHeld();
    expect(confirm.op).toBe("exists");
    expect(row().sync_pending).toBe(1); // not before the confirm read
    confirm.resolve();
    expect(await clearPush).toBe("synced");
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 2 });
    expect(writer.remote.has(scoreId)).toBe(false);
  });

  it("deletes again when the confirm read still sees the score, and keeps the row pending", async () => {
    q.messageFeedbackQueries.upsert(key, 1, null);
    const sync = makeSync({ confirm: { settleMs: 60_000, pollMs: 15_000, deadlineMs: 120_000 } });
    await sync.sync(key);
    q.messageFeedbackQueries.clear(key);
    writer.existsAnswer = () => true; // a late-ingested create
    expect(await sync.sync(key)).toBe("failed");
    const ops = writer.log.map((c) => c.op);
    expect(ops[0]).toBe("upsert");
    expect(ops.at(1)).toBe("remove");
    expect(ops.filter((op) => op === "exists")).toHaveLength(5); // at 60, 75, 90, 105, 120 s
    expect(ops.at(-1)).toBe("remove");
    expect(row()).toMatchObject({ sync_pending: 1, synced_revision: 1 });

    writer.existsAnswer = null;
    clock += 60 * 60_000;
    await sync.reconcile();
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 2 });
  });

  it("👎 held open while 👍 arrives: the 👍 push starts after, final remote value 1", async () => {
    writer.mode = "manual";
    const sync = makeSync();
    q.messageFeedbackQueries.upsert(key, 0, "not useful");
    const down = sync.sync(key);
    const downCall = await writer.nextHeld();
    expect(downCall.body?.value).toBe(0);

    q.messageFeedbackQueries.upsert(key, 1, null);
    const up = sync.sync(key);
    await Bun.sleep(5);
    expect(writer.held).toHaveLength(0);

    downCall.resolve();
    expect(await down).toBe("pending");
    const upCall = await writer.nextHeld();
    expect(upCall.body?.value).toBe(1);
    upCall.resolve();
    expect(await up).toBe("synced");
    expect(writer.remote.get(scoreId)?.value).toBe(1);
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 2 });
  });

  it("coalesces requests while a push is already waiting to start", async () => {
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
    await first;
    (await writer.nextHeld()).resolve();
    expect(await second).toBe("synced");
    expect(writer.log.map((c) => c.value)).toEqual([0, 0]);
    expect(row()).toMatchObject({ revision: 3, sync_pending: 0 });
  });

  it("stops confirming a tombstone once a newer write supersedes it", async () => {
    q.messageFeedbackQueries.upsert(key, 0, null);
    let sync = makeSync();
    await sync.sync(key);
    q.messageFeedbackQueries.clear(key);
    let clicked = false;
    sync = makeSync({
      sleep: async () => {
        if (!clicked) q.messageFeedbackQueries.upsert(key, 1, null); // 👍 during the settle wait
        clicked = true;
      },
    });
    expect(await sync.sync(key)).toBe("pending");
    expect(writer.log.map((c) => c.op)).toEqual(["upsert", "remove"]);
    expect(await sync.sync(key)).toBe("synced");
    expect(writer.remote.get(scoreId)?.value).toBe(1);
  });

  it("marks rows synced without a remote write when the turn has no trace", async () => {
    q = createQueries(createTestDb().db);
    seedTracedTurn(q, null);
    q.messageFeedbackQueries.upsert(key, 1, null);
    expect(await makeSync().sync(key)).toBe("synced");
    expect(writer.log).toEqual([]);
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 1 });
  });

  it("reconciliation lands feedback given while Langfuse was unreachable, with backoff", async () => {
    const sync = makeSync({ backoff: { baseMs: 60_000, maxMs: 3_600_000 } });
    q.messageFeedbackQueries.upsert(key, 1, null);
    writer.failNext.push(new TypeError("fetch failed"));
    expect(await sync.sync(key)).toBe("failed");

    await sync.reconcile(); // not due yet
    expect(writer.log).toHaveLength(1);

    writer.failNext.push(new TypeError("fetch failed"));
    clock += 60_000;
    await sync.reconcile();
    expect(writer.log).toHaveLength(2);
    expect(row().sync_pending).toBe(1);

    clock += 60_000; // second failure doubled the wait to 2 min
    await sync.reconcile();
    expect(writer.log).toHaveLength(2);
    clock += 60_000;
    await sync.reconcile();
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 1 });
    expect(writer.remote.get(scoreId)?.value).toBe(1);
  });
});
