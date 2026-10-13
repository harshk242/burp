import { describe, expect, it } from "bun:test";
import { createScoreWriter, scoreWriterFromEnv, ScoreWriteError, type ScoreUpsert } from "../score-writer";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch stub answering every call with `respond`, recording what it saw. */
function stub(respond: (seen: Seen, signal: AbortSignal | undefined) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchStub = (async (url: string, init: RequestInit = {}) => {
    const call: Seen = {
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    seen.push(call);
    return respond(call, init.signal ?? undefined);
  }) as unknown as typeof fetch;
  const writer = createScoreWriter({
    baseUrl: "https://lf.example.com/",
    publicKey: "pk-lf-1",
    secretKey: "sk-lf-2",
    timeoutMs: 30,
    fetch: fetchStub,
  });
  return { writer, seen };
}

const body: ScoreUpsert = {
  id: "fb-abc",
  traceId: "0123456789abcdef0123456789abcdef",
  name: "user_feedback",
  value: 1,
  dataType: "NUMERIC",
  environment: "dev",
  comment: null,
};

const status = (code: number, json: unknown = {}) => new Response(JSON.stringify(json), { status: code });

describe("score writer", () => {
  it("upserts with Basic auth and the score as the JSON body", async () => {
    const { writer, seen } = stub(() => status(200, { id: "fb-abc" }));
    await writer.upsert(body);
    expect(seen).toEqual([
      {
        url: "https://lf.example.com/api/public/scores",
        method: "POST",
        headers: { Authorization: `Basic ${btoa("pk-lf-1:sk-lf-2")}`, "Content-Type": "application/json" },
        body,
      },
    ]);
  });

  it("deletes by id; 202 and 404 resolve", async () => {
    for (const code of [202, 404]) {
      const { writer, seen } = stub(() => status(code));
      await writer.remove("fb-abc");
      expect(seen[0]).toMatchObject({ url: "https://lf.example.com/api/public/scores/fb-abc", method: "DELETE" });
      expect(seen[0]!.headers.Authorization).toStartWith("Basic ");
    }
  });

  it("rejects 5xx and 4xx (other than 404 on delete)", async () => {
    await expect(stub(() => status(503)).writer.upsert(body)).rejects.toBeInstanceOf(ScoreWriteError);
    await expect(stub(() => status(500)).writer.remove("fb-abc")).rejects.toMatchObject({ status: 500 });
    await expect(stub(() => status(404)).writer.upsert(body)).rejects.toMatchObject({ status: 404 });
    await expect(stub(() => status(400)).writer.exists("fb-abc")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects on timeout", async () => {
    const { writer } = stub(
      (_seen, signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        })
    );
    const started = Date.now();
    await expect(writer.upsert(body)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("reads existence through the v3 scores id filter", async () => {
    const present = stub(() => status(200, { data: [{ id: "fb-abc" }], meta: {} }));
    expect(await present.writer.exists("fb-abc")).toBe(true);
    expect(present.seen[0]).toMatchObject({ url: "https://lf.example.com/api/public/v3/scores?id=fb-abc&limit=1", method: "GET" });
    expect(await stub(() => status(200, { data: [], meta: {} })).writer.exists("fb-abc")).toBe(false);
  });

  it("is built from env only when both keys are set", () => {
    expect(scoreWriterFromEnv({ LANGFUSE_PUBLIC_KEY: "pk" })).toBeNull();
    expect(scoreWriterFromEnv({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" })).not.toBeNull();
  });
});
