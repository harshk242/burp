/**
 * Feedback category scores: every push writes all 10 BOOLEAN `feedback_<id>`
 * scores (never deletes them), awaits all of them before the push settles,
 * and marks the row synced only once every category write succeeded.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createTestDb } from "../../__test-utils__/db";
import { createQueries, type FeedbackKey } from "../../db/queries";
import { ALL_CATEGORY_IDS, type FeedbackCategory } from "../../schemas/feedback-categories";
import { feedbackCategoryScoreId } from "../feedback-category-scores";
import { createFeedbackSync, feedbackScoreId, type FeedbackSyncOptions } from "../feedback-sync";
import { resetScoreConfigIdsForTests, setScoreConfigIdsForTests } from "../score-configs";
import { FakeScoreWriter, ids, seedTracedTurn } from "./feedback-test-utils";

const key: FeedbackKey = { messageId: ids.assistantMessage, userId: ids.user };
const scoreId = feedbackScoreId(key);
const categoryId = (category: FeedbackCategory) => feedbackCategoryScoreId(key, category);

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
    backoff: { baseMs: 60_000, maxMs: 3_600_000 },
    ...overrides,
  });
}

const row = () => q.messageFeedbackQueries.find(key)!;

/** Remote category values by category id. */
function categoryValues(): Record<string, number | undefined> {
  return Object.fromEntries(ALL_CATEGORY_IDS.map((c) => [c, writer.remote.get(categoryId(c))?.value]));
}

/** All 10 categories: 1 for `selected`, else 0. */
function expected(selected: FeedbackCategory[]): Record<string, number> {
  return Object.fromEntries(ALL_CATEGORY_IDS.map((c) => [c, selected.includes(c) ? 1 : 0]));
}

beforeEach(() => {
  q = createQueries(createTestDb().db);
  seedTracedTurn(q);
  writer = new FakeScoreWriter();
  clock = 1_000_000;
});

afterEach(() => resetScoreConfigIdsForTests());

describe("feedback category score id", () => {
  it("is stable per (message, user, category) and distinct from the main score", () => {
    const ids10 = ALL_CATEGORY_IDS.map(categoryId);
    expect(new Set(ids10).size).toBe(10);
    for (const id of ids10) expect(id).toMatch(/^fbc-[0-9a-f]{32}$/);
    expect(categoryId("accurate")).toBe(feedbackCategoryScoreId({ ...key }, "accurate"));
    expect(feedbackCategoryScoreId({ ...key, userId: ids.otherUser }, "accurate")).not.toBe(categoryId("accurate"));
    expect(ids10).not.toContain(scoreId);
  });
});

describe("feedback category sync", () => {
  it("an upsert writes the main score plus all 10 category scores", async () => {
    setScoreConfigIdsForTests({ user_feedback: "cfg-main", feedback_accurate: "cfg-accurate" });
    q.messageFeedbackQueries.upsert(key, 1, "great", ["accurate", "saved_time"]);
    expect(await makeSync().sync(key)).toBe("synced");

    expect(writer.remote.get(scoreId)).toMatchObject({
      value: 1,
      configId: "cfg-main",
      metadata: { message_id: ids.assistantMessage, categories: ["accurate", "saved_time"] },
    });
    expect(categoryValues()).toEqual(expected(["accurate", "saved_time"]));
    expect(writer.remote.get(categoryId("accurate"))).toMatchObject({
      traceId: ids.traceId,
      name: "feedback_accurate",
      dataType: "BOOLEAN",
      environment: "test",
      configId: "cfg-accurate",
      metadata: { message_id: ids.assistantMessage },
    });
    expect(writer.remote.get(categoryId("clear"))).toMatchObject({ name: "feedback_clear", value: 0 });
    expect(writer.log.filter((c) => c.op === "upsert")).toHaveLength(11);
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 1 });
  });

  it("a tombstone deletes the main score and upserts every category score as 0", async () => {
    const sync = makeSync();
    q.messageFeedbackQueries.upsert(key, 0, null, ["outdated", "wrong_citation"]);
    await sync.sync(key);
    q.messageFeedbackQueries.clear(key);
    expect(await sync.sync(key)).toBe("synced");

    expect(writer.remote.has(scoreId)).toBe(false);
    expect(categoryValues()).toEqual(expected([]));
    expect(writer.log.filter((c) => c.op === "remove").map((c) => c.id)).toEqual([scoreId]); // categories never deleted
    expect(row()).toMatchObject({ sync_pending: 0, delete_unconfirmed: 0 });
  });

  it("a polarity flip sets the old polarity's category scores to 0", async () => {
    const sync = makeSync();
    q.messageFeedbackQueries.upsert(key, 0, null, ["factually_incorrect", "incomplete"]);
    await sync.sync(key);
    expect(categoryValues()).toEqual(expected(["factually_incorrect", "incomplete"]));

    q.messageFeedbackQueries.upsert(key, 1, null, ["well_sourced"]);
    expect(await sync.sync(key)).toBe("synced");
    expect(categoryValues()).toEqual(expected(["well_sourced"]));
    expect(writer.remote.get(scoreId)?.metadata).toMatchObject({ categories: ["well_sourced"] });
  });

  it("upsert path: a failed category write fails the push, keeps the row pending, and reconciliation retries it", async () => {
    const sync = makeSync();
    q.messageFeedbackQueries.upsert(key, 0, null, ["off_target"]);
    let failures = 1;
    writer.failWhen = (_op, id) => (id === categoryId("off_target") && failures-- > 0 ? new TypeError("fetch failed") : null);

    expect(await sync.sync(key)).toBe("failed");
    expect(writer.remote.get(scoreId)?.value).toBe(0); // the main score landed, but the row is not synced
    expect(row()).toMatchObject({ sync_pending: 1, synced_revision: null });

    clock += 60_000;
    await sync.reconcile();
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 1 });
    expect(categoryValues()).toEqual(expected(["off_target"]));
  });

  it("tombstone path: a failed category write keeps the row pending and delete_unconfirmed set; the retry confirms", async () => {
    const sync = makeSync();
    q.messageFeedbackQueries.upsert(key, 1, null, ["clear"]);
    await sync.sync(key);
    q.messageFeedbackQueries.clear(key);
    let failures = 1;
    writer.failWhen = (_op, id) => (id === categoryId("clear") && failures-- > 0 ? new TypeError("fetch failed") : null);

    expect(await sync.sync(key)).toBe("failed");
    expect(writer.log.some((c) => c.op === "exists")).toBe(false); // failed before the read-back
    expect(row()).toMatchObject({ sync_pending: 1, synced_revision: 1, delete_unconfirmed: 1 });
    expect(writer.remote.get(categoryId("clear"))?.value).toBe(1);

    clock += 60_000;
    await sync.reconcile();
    expect(row()).toMatchObject({ sync_pending: 0, synced_revision: 2, delete_unconfirmed: 0 });
    expect(writer.remote.has(scoreId)).toBe(false);
    expect(categoryValues()).toEqual(expected([]));
  });

  it("a push settles only once every category request settled; the queued newer revision wins everywhere", async () => {
    writer.mode = "manual";
    writer.hold = (_op, id) => id === categoryId("factually_incorrect");
    let failures = 1;
    writer.failWhen = (_op, id) => (id === categoryId("wrong_citation") && failures-- > 0 ? new TypeError("fetch failed") : null);
    const sync = makeSync();

    q.messageFeedbackQueries.upsert(key, 0, null, ["factually_incorrect", "wrong_citation"]);
    let firstSettled = false;
    const first = sync.sync(key).then((result) => {
      firstSettled = true;
      return result;
    });
    const stale = await writer.nextHeld();
    expect(stale.body?.value).toBe(1);

    q.messageFeedbackQueries.upsert(key, 1, null, ["accurate"]);
    const second = sync.sync(key);
    await Bun.sleep(5);
    expect(failures).toBe(0); // the sibling write already rejected...
    expect(firstSettled).toBe(false); // ...but the push waits for the held request
    expect(writer.log.filter((c) => c.id === scoreId)).toHaveLength(1); // and the newer push has not started

    stale.resolve();
    expect(await first).toBe("failed");
    const fresh = await writer.nextHeld();
    expect(fresh.body?.value).toBe(0);
    fresh.resolve();
    expect(await second).toBe("synced");

    expect(writer.remote.get(scoreId)).toMatchObject({ value: 1, metadata: { categories: ["accurate"] } });
    expect(categoryValues()).toEqual(expected(["accurate"]));
    expect(row()).toMatchObject({ revision: 2, sync_pending: 0, synced_revision: 2 });
  });
});
