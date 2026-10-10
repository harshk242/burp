/**
 * createEmbedder with provider HTTP stubbed: request shapes per provider,
 * identity, the missing-key short-circuit, response validation, and the
 * query deadline. No network calls.
 */
import { describe, expect, it } from "bun:test";
import { createEmbedder } from "../embeddings/factory";
import { EmbeddingResponseError, EmbeddingTimeoutError, type EmbeddingSpec } from "../embeddings/types";

interface Call {
  url: string;
  body: any;
  headers: Headers;
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/** OpenAI /v1/embeddings stub returning `vector` for every input. */
function openaiFetch(vector: number[] | ((i: number) => unknown)) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body, headers: new Headers(init?.headers) });
    const inputs: string[] = body.input;
    return json({
      object: "list",
      data: inputs.map((_, i) => ({ object: "embedding", index: i, embedding: typeof vector === "function" ? vector(i) : vector })),
      model: body.model,
      usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** Gemini embedContent / batchEmbedContents stub. */
function googleFetch(vector: number[]) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body, headers: new Headers(init?.headers) });
    if (String(url).includes(":batchEmbedContents")) {
      return json({ embeddings: body.requests.map(() => ({ values: vector })) });
    }
    return json({ embedding: { values: vector } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const OPENAI: EmbeddingSpec = { provider: "openai", model: "text-embedding-3-small", dimensions: 3 };
const GOOGLE: EmbeddingSpec = { provider: "google", model: "gemini-embedding-001", dimensions: 3 };

describe("OpenAI embedder", () => {
  it("posts model, input and dimensions to /v1/embeddings", async () => {
    const stub = openaiFetch([0.1, 0.2, 0.3]);
    const embedder = createEmbedder(OPENAI, { env: { OPENAI_API_KEY: "sk-test" }, fetch: stub.fetch })!;

    expect(embedder.id).toBe("openai:text-embedding-3-small@3");
    const vector = await embedder.embedQuery("toxic to the liver");

    expect(Array.from(vector)).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3])));
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].url).toBe("https://api.openai.com/v1/embeddings");
    expect(stub.calls[0].headers.get("authorization")).toBe("Bearer sk-test");
    expect(stub.calls[0].body).toMatchObject({ model: "text-embedding-3-small", input: ["toxic to the liver"], dimensions: 3 });
  });

  it("omits dimensions when none is configured and uses the native size", async () => {
    const stub = openaiFetch([1, 2, 3, 4, 5]);
    const spec: EmbeddingSpec = { provider: "openai", model: "text-embedding-3-small" };
    const embedder = createEmbedder(spec, { env: { OPENAI_API_KEY: "sk-test" }, fetch: stub.fetch })!;

    expect(embedder.id).toBe("openai:text-embedding-3-small@native");
    const docs = await embedder.embedDocuments(["a", "b"]);

    expect(docs.map((d) => d.length)).toEqual([5, 5]);
    expect("dimensions" in stub.calls[0].body).toBe(false);
    expect(stub.calls[0].body.input).toEqual(["a", "b"]);
  });

  it("only copies spec fields into embedder.spec", () => {
    const config = { ...OPENAI, query_timeout_ms: 2000 };
    const embedder = createEmbedder(config, { env: { OPENAI_API_KEY: "k" }, fetch: openaiFetch([0]).fetch })!;
    expect(embedder.spec).toEqual(OPENAI);
  });
});

describe("Google embedder", () => {
  it("uses RETRIEVAL_QUERY for queries and maps dimensions to outputDimensionality", async () => {
    const stub = googleFetch([0.1, 0.2, 0.3]);
    const embedder = createEmbedder(GOOGLE, { env: { GEMINI_API_KEY: "g-test" }, fetch: stub.fetch })!;

    expect(embedder.id).toBe("google:gemini-embedding-001@3");
    await embedder.embedQuery("hepatotoxicity");

    expect(stub.calls[0].url).toContain("/models/gemini-embedding-001:embedContent");
    expect(stub.calls[0].body).toMatchObject({ taskType: "RETRIEVAL_QUERY", outputDimensionality: 3 });
  });

  it("uses RETRIEVAL_DOCUMENT for documents", async () => {
    const stub = googleFetch([0.1, 0.2, 0.3]);
    const embedder = createEmbedder(GOOGLE, { env: { GOOGLE_GENERATIVE_AI_API_KEY: "g-test" }, fetch: stub.fetch })!;

    await embedder.embedDocuments(["a", "b"]);

    expect(stub.calls[0].url).toContain(":batchEmbedContents");
    for (const req of stub.calls[0].body.requests) {
      expect(req).toMatchObject({ taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 3 });
    }
  });
});

describe("missing API key", () => {
  it.each([OPENAI, GOOGLE])("returns null for $provider and never calls the provider", (spec) => {
    let called = false;
    const fetch = (async () => {
      called = true;
      return json({});
    }) as unknown as typeof globalThis.fetch;

    expect(createEmbedder(spec, { env: {}, fetch })).toBeNull();
    expect(called).toBe(false);
  });

  it("does not take an OpenAI key for the Google provider", () => {
    expect(createEmbedder(GOOGLE, { env: { OPENAI_API_KEY: "sk" } })).toBeNull();
  });
});

describe("response validation", () => {
  const env = { OPENAI_API_KEY: "sk-test" };

  it("rejects a vector of the wrong length", async () => {
    const embedder = createEmbedder(OPENAI, { env, fetch: openaiFetch([0.1, 0.2]).fetch })!;
    await expect(embedder.embedQuery("q")).rejects.toBeInstanceOf(EmbeddingResponseError);
  });

  it("rejects non-finite values", async () => {
    // 1e999 parses to Infinity. The SDK's response schema or our own check rejects it.
    const fetch = (async () =>
      new Response('{"object":"list","data":[{"object":"embedding","index":0,"embedding":[0.1,1e999,0.3]}],"model":"m","usage":{"prompt_tokens":1,"total_tokens":1}}', {
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch;
    const embedder = createEmbedder(OPENAI, { env, fetch })!;
    await expect(embedder.embedQuery("q")).rejects.toThrow();
  });

  it("rejects values that overflow float32 (1e100 → Infinity)", async () => {
    const fetch = openaiFetch([0.1, 1e100, 0.3]).fetch;
    const embedder = createEmbedder(OPENAI, { env, fetch })!;
    await expect(embedder.embedQuery("q")).rejects.toBeInstanceOf(EmbeddingResponseError);
    await expect(embedder.embedDocuments(["a"])).rejects.toBeInstanceOf(EmbeddingResponseError);
  });

  it("rejects a document batch with inconsistent lengths when no size is configured", async () => {
    const spec: EmbeddingSpec = { provider: "openai", model: "text-embedding-3-small" };
    const fetch = openaiFetch((i) => (i === 0 ? [1, 2, 3] : [1, 2])).fetch;
    const embedder = createEmbedder(spec, { env, fetch })!;
    await expect(embedder.embedDocuments(["a", "b"])).rejects.toBeInstanceOf(EmbeddingResponseError);
  });
});

describe("query deadline", () => {
  it("rejects a stalled query after the timeout without retrying", async () => {
    let calls = 0;
    // Never responds; settles only when the request is aborted.
    const fetch = ((_url: unknown, init?: RequestInit) => {
      calls++;
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    }) as unknown as typeof globalThis.fetch;
    const embedder = createEmbedder(OPENAI, { env: { OPENAI_API_KEY: "sk" }, fetch, queryTimeoutMs: 50 })!;

    const started = performance.now();
    await expect(embedder.embedQuery("q")).rejects.toBeInstanceOf(EmbeddingTimeoutError);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(calls).toBe(1);
  });

  it("aborts the request when the caller's signal aborts", async () => {
    let signal: AbortSignal | undefined;
    const fetch = ((_url: unknown, init?: RequestInit) => {
      signal = init!.signal!;
      return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(signal!.reason)));
    }) as unknown as typeof globalThis.fetch;
    const embedder = createEmbedder(OPENAI, { env: { OPENAI_API_KEY: "sk" }, fetch, queryTimeoutMs: 10_000 })!;
    const caller = new AbortController();

    const query = embedder.embedQuery("q", caller.signal);
    while (!signal) await Bun.sleep(0);
    caller.abort(new Error("user went away"));

    await expect(query).rejects.toThrow("user went away");
    expect(signal.aborted).toBe(true);
  });

  it("holds even when the transport ignores the abort signal", async () => {
    const fetch = (() => new Promise(() => {})) as unknown as typeof globalThis.fetch;
    const embedder = createEmbedder(OPENAI, { env: { OPENAI_API_KEY: "sk" }, fetch, queryTimeoutMs: 30 })!;
    await expect(embedder.embedQuery("q")).rejects.toBeInstanceOf(EmbeddingTimeoutError);
  });
});
