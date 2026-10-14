import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createEmbedder } from "../embeddings/factory";
import { toolEmbeddingText, writeToolEmbeddings } from "../embeddings/index-file";
import { syncToolEmbeddings, type SyncTool } from "../embeddings/sync-index";
import { ToolEmbeddingSync, type Scheduler } from "../embeddings/sync-queue";
import { EmbeddingTimeoutError, type Embedder } from "../embeddings/types";
import { logger } from "../logger";

const root = mkdtempSync(join(tmpdir(), "burp-embeddings-resilience-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let path: string;
let n = 0;
beforeEach(() => {
  path = join(root, `idx-${++n}`, "tool-embeddings.json");
});

let warnSpy: ReturnType<typeof spyOn<typeof logger, "warn">> | null = null;
afterEach(() => warnSpy?.mockRestore());

const DIM = 3;
const vectorFor = (text: string) => new Float32Array([text.length, 1, 0.5]);
const tool = (fullName: string, description: string): SyncTool => ({ fullName, server: fullName.split("__")[0], description });
const textOf = (t: SyncTool) => toolEmbeddingText(t.fullName, t.description);

const A = tool("alpha__one", "First alpha tool");
const B = tool("beta__one", "First beta tool");
const A_CHANGED = { ...A, description: "First alpha tool, now paginated" };

function fakeEmbedder(id = "fake:model@3") {
  const batches: string[][] = [];
  const held: Array<() => void> = [];
  const state = { fail: null as unknown, defer: false };
  const embedder: Embedder = {
    id,
    spec: { provider: "openai", model: id, dimensions: DIM },
    embedQuery: async (text) => vectorFor(text),
    async embedDocuments(texts) {
      batches.push(texts);
      if (state.defer) await new Promise<void>((resolve) => held.push(resolve));
      if (state.fail) throw state.fail;
      return texts.map(vectorFor);
    },
  };
  return { embedder, batches, state, release: () => held.splice(0).forEach((fn) => fn()) };
}

async function seed(embedderId: string, tools: SyncTool[], dimension = DIM) {
  const entries = tools.map((t) => ({ fullName: t.fullName, text: textOf(t), vector: vectorFor(textOf(t)).slice(0, dimension) }));
  await writeToolEmbeddings(path, { embedder: embedderId, dimension }, entries);
}

const readIndex = () => JSON.parse(readFileSync(path, "utf-8")) as { dimension: number; tools: { full_name: string; text: string }[] };

function fakeScheduler() {
  const live: Array<() => void> = [];
  const scheduler: Scheduler = (fn) => {
    live.push(fn);
    return () => live.splice(live.indexOf(fn), 1);
  };
  return { scheduler, fire: () => live.shift()!() };
}

function queue(embedder: Embedder, scheduler = fakeScheduler().scheduler) {
  const state = { current: null as Map<string, Float32Array> | null };
  const q = new ToolEmbeddingSync({
    embedder,
    path,
    timeoutMs: 5000,
    scheduler,
    random: () => 0.5,
    onReady: (_, vectors) => (state.current = vectors),
  });
  return { q, state };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function rejections() {
  return warnSpy!.mock.calls.filter((c) => c[1] === "embeddings_index_rejected").map((c) => c[2]?.data);
}

describe("a failed sync keeps attached vectors", () => {
  it("401 after a description change → both tools keep their stored vectors", async () => {
    const fetch = (async () => json({ error: { message: "Incorrect API key", type: "invalid_request_error" } }, 401)) as unknown as typeof globalThis.fetch;
    const embedder = createEmbedder({ provider: "openai", model: "text-embedding-3-small", dimensions: DIM }, { env: { OPENAI_API_KEY: "sk-bad" }, fetch })!;
    await seed(embedder.id, [A, B]);
    const before = readFileSync(path, "utf-8");
    const { q, state } = queue(embedder);

    q.request([A, B]);
    await q.idle();
    expect([...state.current!.keys()].sort()).toEqual(["alpha__one", "beta__one"]);

    q.request([A_CHANGED, B]);
    await q.idle();

    expect([...state.current!.keys()].sort()).toEqual(["alpha__one", "beta__one"]);
    expect(state.current!.get("alpha__one")).toEqual(vectorFor(textOf(A)));
    expect(readFileSync(path, "utf-8")).toBe(before);
  });

  it("serves stale-text vectors from the file while their re-embedding runs", async () => {
    const fake = fakeEmbedder();
    await seed(fake.embedder.id, [A, B]);
    fake.state.defer = true;
    const attached: Map<string, Float32Array>[] = [];

    const run = syncToolEmbeddings({ embedder: fake.embedder, tools: [A_CHANGED, B], path, timeoutMs: 5000, onReady: (v) => attached.push(v) });
    while (fake.batches.length < 1) await Bun.sleep(0);

    expect(fake.batches).toEqual([[textOf(A_CHANGED)]]);
    expect([...attached[0].keys()].sort()).toEqual(["alpha__one", "beta__one"]);
    expect(attached[0].get("alpha__one")).toEqual(vectorFor(textOf(A)));

    fake.release();
    await run;
    expect(attached.at(-1)!.get("alpha__one")).toEqual(vectorFor(textOf(A_CHANGED)));
  });
});

describe("batch failure", () => {
  it("aborts sibling batch requests as soon as one batch fails", async () => {
    const tools = Array.from({ length: 2049 }, (_, i) => tool(`alpha__t${i}`, `tool ${i}`));
    let stalled: AbortSignal | undefined;
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      const inputs: string[] = JSON.parse(String(init?.body)).input;
      if (inputs.length === 1) return json({ error: { message: "bad request", type: "invalid_request_error" } }, 400);
      stalled = init!.signal!;
      return new Promise((_, reject) => stalled!.addEventListener("abort", () => reject(stalled!.reason)));
    }) as unknown as typeof globalThis.fetch;
    const embedder = createEmbedder({ provider: "openai", model: "text-embedding-3-small", dimensions: DIM }, { env: { OPENAI_API_KEY: "sk" }, fetch })!;

    const started = performance.now();
    await expect(syncToolEmbeddings({ embedder, tools, path, timeoutMs: 30_000, onReady: () => {} })).rejects.toThrow(/bad request/);

    expect(performance.now() - started).toBeLessThan(5000);
    expect(stalled).toBeDefined();
    expect(stalled!.aborted).toBe(true);
  });
});

describe("dimension contradicting the embedder", () => {
  it("rebuilds a file whose header size differs from the configured one", async () => {
    const fake = fakeEmbedder();
    await seed(fake.embedder.id, [A, B], 2);

    const attached: Map<string, Float32Array>[] = [];
    const stats = await syncToolEmbeddings({ embedder: fake.embedder, tools: [A, B], path, timeoutMs: 5000, onReady: (v) => attached.push(v) });

    expect(stats).toMatchObject({ index: "dimension_mismatch", kept: 0, embedded: 2, wrote: true });
    expect(fake.batches).toEqual([[textOf(A), textOf(B)]]);
    expect(readIndex().dimension).toBe(DIM);
    expect(attached.map((m) => m.get("alpha__one")?.length)).toEqual([DIM]);
  });
});

describe("rejected index warning", () => {
  it("warns once with reason/found/expected, not again on retries, and not for a missing file", async () => {
    warnSpy = spyOn(logger, "warn");
    await seed("old:model@3", [A]);
    const fake = fakeEmbedder("new:model@3");
    fake.state.fail = new EmbeddingTimeoutError("slow");
    const timers = fakeScheduler();
    const { q } = queue(fake.embedder, timers.scheduler);

    q.request([A]);
    await q.idle();
    timers.fire();
    await q.idle();
    expect(fake.batches).toHaveLength(2);
    expect(rejections()).toEqual([{ path, reason: "embedder_mismatch", found: "old:model@3", expected: "new:model@3" }]);

    fake.state.fail = null;
    timers.fire();
    await q.idle();
    expect(rejections()).toHaveLength(1);

    rmSync(path);
    q.request([A]);
    await q.idle();
    expect(rejections()).toHaveLength(1);
  });
});
