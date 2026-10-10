/**
 * Background sync of the tool embeddings index: incremental reuse, per-platform
 * prune vs carry-over, never mixing models, retry classification and timing
 * (fake scheduler), and latest-wins coalescing. Fake embedder, temp dirs, no network.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { APICallError, RetryError } from "ai";
import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createEmbedder } from "../embeddings/factory";
import { toolEmbeddingText, writeToolEmbeddings } from "../embeddings/index-file";
import { syncToolEmbeddings, type SyncTool } from "../embeddings/sync-index";
import { isRetryableSyncError, ToolEmbeddingSync, type Scheduler } from "../embeddings/sync-queue";
import { EmbeddingResponseError, EmbeddingTimeoutError, type Embedder } from "../embeddings/types";

const root = mkdtempSync(join(tmpdir(), "burp-embeddings-sync-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let path: string;
let n = 0;
beforeEach(() => {
  path = join(root, `idx-${++n}`, "tool-embeddings.json");
});

const DIM = 3;
const vectorFor = (text: string) => new Float32Array([text.length, 1, 0.5]);

function tool(fullName: string, description: string): SyncTool {
  return { fullName, server: fullName.split("__")[0], description };
}

const A1 = tool("alpha__one", "First alpha tool");
const A2 = tool("alpha__two", "Second alpha tool");
const B1 = tool("beta__one", "First beta tool");

/** Records every embedDocuments batch; `failures` (one per call) or `fail` throws, `defer` holds calls until released. */
function fakeEmbedder(id = "fake:model@3") {
  const batches: string[][] = [];
  const held: Array<() => void> = [];
  const state = { fail: null as unknown, failures: [] as unknown[], defer: false };
  const embedder: Embedder = {
    id,
    spec: { provider: "openai", model: id, dimensions: DIM },
    embedQuery: async (text) => vectorFor(text),
    async embedDocuments(texts) {
      batches.push(texts);
      if (state.defer) await new Promise<void>((resolve) => held.push(resolve));
      const failure = state.failures.length > 0 ? state.failures.shift() : state.fail;
      if (failure) throw failure;
      return texts.map(vectorFor);
    },
  };
  return { embedder, batches, state, release: () => held.splice(0).forEach((fn) => fn()) };
}

/** Write an index made by `embedderId` holding `tools` as they are described now. */
async function seed(embedderId: string, tools: SyncTool[]) {
  const entries = tools.map((t) => {
    const text = toolEmbeddingText(t.fullName, t.description);
    return { fullName: t.fullName, text, vector: vectorFor(text) };
  });
  await writeToolEmbeddings(path, { embedder: embedderId, dimension: DIM }, entries);
}

function readIndex() {
  return JSON.parse(readFileSync(path, "utf-8")) as { embedder: string; generated_at: string; tools: { full_name: string; text: string }[] };
}

async function sync(embedder: Embedder, tools: SyncTool[]) {
  const attached: Map<string, Float32Array>[] = [];
  const stats = await syncToolEmbeddings({ embedder, tools, path, timeoutMs: 1000, onReady: (v) => attached.push(v) });
  return { stats, attached };
}

describe("syncToolEmbeddings", () => {
  it("missing file → embeds every tool, writes, and attaches", async () => {
    const fake = fakeEmbedder();
    const { stats, attached } = await sync(fake.embedder, [A1, B1]);

    expect(stats).toMatchObject({ index: "file_missing", kept: 0, embedded: 2, pruned: 0, carriedOver: 0, wrote: true });
    expect(fake.batches).toEqual([[toolEmbeddingText(A1.fullName, A1.description), toolEmbeddingText(B1.fullName, B1.description)]]);
    expect(readIndex().embedder).toBe("fake:model@3");
    expect(readIndex().tools.map((t) => t.full_name)).toEqual(["alpha__one", "beta__one"]);
    expect(attached).toHaveLength(1);
    expect([...attached[0].keys()].sort()).toEqual(["alpha__one", "beta__one"]);
  });

  it("valid file, nothing changed → no API call and no write, vectors attached", async () => {
    const fake = fakeEmbedder();
    await seed(fake.embedder.id, [A1, B1]);
    const before = { mtime: statSync(path).mtimeMs, content: readFileSync(path, "utf-8") };

    const { stats, attached } = await sync(fake.embedder, [A1, B1]);

    expect(stats).toMatchObject({ index: "valid", kept: 2, embedded: 0, pruned: 0, wrote: false });
    expect(fake.batches).toEqual([]);
    expect(statSync(path).mtimeMs).toBe(before.mtime);
    expect(readFileSync(path, "utf-8")).toBe(before.content);
    expect(attached.map((m) => m.size)).toEqual([2]);
  });

  it("one changed description → re-embeds exactly that tool", async () => {
    const fake = fakeEmbedder();
    await seed(fake.embedder.id, [A1, A2, B1]);
    const changed = { ...A2, description: "Second alpha tool, now with pagination" };

    const { stats, attached } = await sync(fake.embedder, [A1, changed, B1]);

    expect(fake.batches).toEqual([[toolEmbeddingText(changed.fullName, changed.description)]]);
    expect(stats).toMatchObject({ kept: 2, embedded: 1, pruned: 0, wrote: true });
    expect(readIndex().tools.find((t) => t.full_name === "alpha__two")?.text).toContain("pagination");
    // Kept vectors are served first, then the full set once written.
    expect(attached.map((m) => [...m.keys()].sort())).toEqual([
      ["alpha__one", "beta__one"],
      ["alpha__one", "alpha__two", "beta__one"],
    ]);
  });

  it("model mismatch → re-embeds everything under the new identity", async () => {
    await seed("old:model@3", [A1, B1]);
    const fake = fakeEmbedder("new:model@3");

    const { stats } = await sync(fake.embedder, [A1, B1]);

    expect(stats).toMatchObject({ index: "embedder_mismatch", kept: 0, embedded: 2, carriedOver: 0 });
    expect(fake.batches[0]).toHaveLength(2);
    expect(readIndex().embedder).toBe("new:model@3");
  });

  it("model mismatch + absent platform → nothing carried over from the old model", async () => {
    await seed("old:model@3", [A1, B1]);
    const fake = fakeEmbedder("new:model@3");

    const { stats } = await sync(fake.embedder, [A1]); // beta's server is down

    expect(stats).toMatchObject({ embedded: 1, carriedOver: 0, pruned: 0 });
    const index = readIndex();
    expect(index.embedder).toBe("new:model@3");
    expect(index.tools.map((t) => t.full_name)).toEqual(["alpha__one"]);
  });

  it("empty registry → no API call, existing file left as is, nothing attached", async () => {
    const fake = fakeEmbedder();
    await seed(fake.embedder.id, [A1, B1]);
    const content = readFileSync(path, "utf-8");

    const { stats, attached } = await sync(fake.embedder, []);

    expect(stats).toMatchObject({ kept: 0, embedded: 0, pruned: 0, carriedOver: 2, wrote: false });
    expect(fake.batches).toEqual([]);
    expect(readFileSync(path, "utf-8")).toBe(content);
    expect(attached).toEqual([]);
  });

  it("prunes removed tools of discovered platforms and carries over absent platforms", async () => {
    const fake = fakeEmbedder();
    await seed(fake.embedder.id, [A1, A2, B1]);

    // alpha discovered without alpha__two; beta's server is down.
    const { stats, attached } = await sync(fake.embedder, [A1]);

    expect(stats).toMatchObject({ kept: 1, embedded: 0, pruned: 1, carriedOver: 1, wrote: true });
    expect(fake.batches).toEqual([]); // pruning alone needs no API call
    expect(readIndex().tools.map((t) => t.full_name)).toEqual(["alpha__one", "beta__one"]);
    // Only the snapshot's vectors are attached; carried-over ones stay in the file.
    expect([...attached[0].keys()]).toEqual(["alpha__one"]);
  });

  it("a stalled embedding call fails with EmbeddingTimeoutError at the deadline", async () => {
    const fake = fakeEmbedder();
    fake.state.defer = true;
    const run = syncToolEmbeddings({ embedder: fake.embedder, tools: [A1], path, timeoutMs: 20, onReady: () => {} });
    await expect(run).rejects.toBeInstanceOf(EmbeddingTimeoutError);
    fake.release();
  });
});

describe("isRetryableSyncError", () => {
  const apiError = (statusCode: number) =>
    new APICallError({ message: `HTTP ${statusCode}`, url: "https://api.openai.com/v1/embeddings", requestBodyValues: {}, statusCode });

  it("retries transient failures", () => {
    expect(isRetryableSyncError(apiError(429))).toBe(true);
    expect(isRetryableSyncError(apiError(503))).toBe(true);
    expect(isRetryableSyncError(new RetryError({ message: "gave up", reason: "maxRetriesExceeded", errors: [apiError(429)] }))).toBe(true);
    expect(isRetryableSyncError(new EmbeddingTimeoutError("slow"))).toBe(true);
  });

  it("does not retry auth/config errors or invalid responses", () => {
    expect(isRetryableSyncError(apiError(401))).toBe(false);
    expect(isRetryableSyncError(apiError(400))).toBe(false);
    expect(isRetryableSyncError(new RetryError({ message: "gave up", reason: "errorNotRetryable", errors: [apiError(429), apiError(403)] }))).toBe(false);
    expect(isRetryableSyncError(new EmbeddingResponseError("bad vector"))).toBe(false);
    expect(isRetryableSyncError(new Error("bug"))).toBe(false);
  });
});

/** Timers that only fire when the test says so. */
function fakeScheduler() {
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const scheduler: Scheduler = (fn, ms) => {
    const timer = { fn, ms, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const live = () => timers.filter((t) => !t.cancelled);
  const fire = () => {
    const timer = live()[0];
    timer.cancelled = true;
    timer.fn();
  };
  return { scheduler, timers, live, fire };
}

function queue(embedder: Embedder, scheduler: Scheduler) {
  const attached: Map<string, Float32Array>[] = [];
  const q = new ToolEmbeddingSync({
    embedder,
    path,
    timeoutMs: 1000,
    scheduler,
    random: () => 0.5, // no jitter
    onReady: (_, vectors) => attached.push(vectors),
  });
  return { q, attached };
}

describe("ToolEmbeddingSync", () => {
  it("401 from the provider → no write, nothing attached, no retry", async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "Incorrect API key", type: "invalid_request_error" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
    const embedder = createEmbedder({ provider: "openai", model: "text-embedding-3-small", dimensions: DIM }, { env: { OPENAI_API_KEY: "sk-bad" }, fetch })!;
    const timers = fakeScheduler();
    const { q, attached } = queue(embedder, timers.scheduler);

    q.request([A1]);
    await q.idle();

    expect(calls).toBe(1); // the SDK doesn't retry a 401 either
    expect(() => statSync(path)).toThrow();
    expect(attached).toEqual([]);
    expect(timers.timers).toEqual([]);
    expect(q.retryScheduled).toBe(false);
  });

  it("429 → retried after ~1 min and succeeds", async () => {
    const fake = fakeEmbedder();
    fake.state.fail = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [new APICallError({ message: "rate limited", url: "u", requestBodyValues: {}, statusCode: 429 })],
    });
    const timers = fakeScheduler();
    const { q, attached } = queue(fake.embedder, timers.scheduler);

    q.request([A1]);
    await q.idle();
    expect(attached).toEqual([]);
    expect(timers.live().map((t) => t.ms)).toEqual([60_000]);

    fake.state.fail = null;
    timers.fire();
    await q.idle();

    expect(fake.batches).toHaveLength(2);
    expect(readIndex().tools.map((t) => t.full_name)).toEqual(["alpha__one"]);
    expect(attached.map((m) => m.size)).toEqual([1]);
    expect(q.retryScheduled).toBe(false);
  });

  it("gives up after three more attempts at ~1 / 5 / 15 min with ±20% jitter", async () => {
    const fake = fakeEmbedder();
    fake.state.fail = new EmbeddingTimeoutError("slow");
    const timers = fakeScheduler();
    let r = 0;
    const randoms = [0, 0.999, 0.5];
    const q = new ToolEmbeddingSync({
      embedder: fake.embedder,
      path,
      timeoutMs: 1000,
      scheduler: timers.scheduler,
      random: () => randoms[r++],
      onReady: () => {},
    });

    q.request([A1]);
    await q.idle();
    for (let i = 0; i < 3; i++) {
      timers.fire();
      await q.idle();
    }

    expect(fake.batches).toHaveLength(4);
    expect(timers.timers.map((t) => t.ms)).toEqual([48_000, Math.round(300_000 * (1 + (0.999 * 2 - 1) * 0.2)), 900_000]);
    expect(q.retryScheduled).toBe(false);
  });

  it("a newer request cancels a scheduled retry and syncs the newer snapshot", async () => {
    const fake = fakeEmbedder();
    fake.state.fail = new EmbeddingTimeoutError("slow");
    const timers = fakeScheduler();
    const { q, attached } = queue(fake.embedder, timers.scheduler);

    q.request([A1]);
    await q.idle();
    expect(q.retryScheduled).toBe(true);

    fake.state.fail = null;
    q.request([A1, B1]);
    await q.idle();

    expect(timers.live()).toEqual([]);
    expect(q.retryScheduled).toBe(false);
    expect([...attached.at(-1)!.keys()].sort()).toEqual(["alpha__one", "beta__one"]);
  });

  it("overlapping requests → exactly one follow-up run, with the latest snapshot", async () => {
    const fake = fakeEmbedder();
    fake.state.defer = true;
    const { q, attached } = queue(fake.embedder, fakeScheduler().scheduler);

    q.request([A1]); // starts
    while (fake.batches.length < 1) await Bun.sleep(0);
    q.request([A1, A2]); // waits…
    q.request([A1, B1]); // …and is replaced by this one
    fake.state.defer = false;
    fake.release();
    await q.idle();

    expect(fake.batches).toEqual([
      [toolEmbeddingText(A1.fullName, A1.description)],
      [toolEmbeddingText(B1.fullName, B1.description)],
    ]);
    expect(readIndex().tools.map((t) => t.full_name)).toEqual(["alpha__one", "beta__one"]);
    expect([...attached.at(-1)!.keys()].sort()).toEqual(["alpha__one", "beta__one"]);
  });

  it("a failure while a newer request waits doesn't retry the superseded snapshot", async () => {
    const fake = fakeEmbedder();
    fake.state.defer = true;
    fake.state.failures = [new EmbeddingTimeoutError("slow")]; // first run only
    const timers = fakeScheduler();
    const { q, attached } = queue(fake.embedder, timers.scheduler);

    q.request([A1]);
    while (fake.batches.length < 1) await Bun.sleep(0);
    q.request([B1]);
    fake.state.defer = false;
    fake.release();
    await q.idle();

    expect(fake.batches).toHaveLength(2);
    expect(timers.timers).toEqual([]);
    expect(attached.map((m) => [...m.keys()])).toEqual([["beta__one"]]);
  });

  it("stop() cancels a scheduled retry and ignores later requests", async () => {
    const fake = fakeEmbedder();
    fake.state.fail = new EmbeddingTimeoutError("slow");
    const timers = fakeScheduler();
    const { q } = queue(fake.embedder, timers.scheduler);

    q.request([A1]);
    await q.idle();
    q.stop();
    q.request([A1]);
    await q.idle();

    expect(timers.live()).toEqual([]);
    expect(fake.batches).toHaveLength(1);
  });
});
