import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { useChatStore } from "@/stores/chatStore";
import { RateLimitError } from "@/types";
import { RATE_LIMIT_ERROR_CODES } from "../../../shared/rate-limit";
import { streamChat } from "../sse";
import { ChatSessionController } from "../chat-session-controller";

const run = () => {
  const controller = new ChatSessionController();
  controller.select("s1");
  return streamChat("s1", "hi", "token", controller.beginTurn("s1"));
};

const store = () => useChatStore.getState();
const realFetch = globalThis.fetch;

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function serve(body: string, chunkSize = 7) {
  const bytes = new TextEncoder().encode(body);
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    )) as unknown as typeof fetch;
}

beforeEach(() => store().reset());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("streamChat decoding", () => {
  it("keeps text chunks that look like JSON or are whitespace-only", async () => {
    const chunks = ["The answer is ", "42", " and ", "true", "/", "null", " ", "\n\n", "\t", '"quoted"', '{"content":"x"}', "[1]", "a\r\nb"];
    serve(frame("start", { sessionId: "s1" }) + chunks.map((c) => frame("text", c)).join(""));

    await run();

    expect(store().streamingContent).toBe(chunks.join(""));
  });

  it("finalizes a message whose whole content is a numeric chunk", async () => {
    serve(frame("text", "42") + frame("done", { messageId: "m1", inputTokens: 1, outputTokens: 2 }));

    await run();

    expect(store().messages).toHaveLength(1);
    expect(store().messages[0]).toMatchObject({ id: "m1", persisted: true, role: "assistant", content: "42", tokenUsage: { input: 1, output: 2 } });
  });

  it("keeps numeric-looking reasoning deltas", async () => {
    serve(frame("reasoning", { text: "42", newBlock: true }) + frame("reasoning", { text: " ", newBlock: false }) + frame("reasoning", { text: "null", newBlock: false }));

    await run();

    expect(store().reasoningSegments).toEqual(["42 null"]);
  });

  it("drops a payload that isn't JSON instead of guessing", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    serve("event: text\ndata: not json\n\n" + frame("text", "ok"));

    await run();

    expect(store().streamingContent).toBe("ok");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("streamChat terminal lifecycle", () => {
  it("completes an empty turn with its own ID and usage atomically", async () => {
    const controller = new ChatSessionController();
    controller.select("s1");
    store().addMessage({ id: "old", role: "assistant", content: "old", createdAt: 1 });
    const snapshots: boolean[] = [];
    const unsubscribe = useChatStore.subscribe((state) => {
      const completed = state.messages.find((m) => m.id === "empty");
      if (completed) snapshots.push(!state.isStreaming && completed.tokenUsage?.input === 12);
    });
    serve(frame("done", { messageId: "empty", inputTokens: 12, outputTokens: 0 }));
    await controller.stream(controller.beginTurn("s1"), "hi", "token", () => {});
    unsubscribe();
    expect(snapshots).toEqual([true]);
    expect(store().messages[0].tokenUsage).toBeUndefined();
    expect(store().messages[1]).toMatchObject({ id: "empty", persisted: true, content: "", tokenUsage: { input: 12, output: 0 } });
  });

  it("ends streaming with an interrupted error on EOF without completion", async () => {
    serve(frame("text", "partial"));
    await run();
    expect(store().isStreaming).toBe(false);
    expect(store().error).toBe("Response interrupted before completion");
    expect(store().messages).toEqual([]);
  });

  it("ignores content and duplicate completion after done but accepts the title", async () => {
    const controller = new ChatSessionController();
    controller.select("s1");
    const titles: string[] = [];
    serve(frame("done", { messageId: "m", inputTokens: 1, outputTokens: 0 }) + frame("text", "late") + frame("done", { messageId: "duplicate", inputTokens: 9, outputTokens: 9 }) + frame("title", { title: "Title" }));
    await controller.stream(controller.beginTurn("s1"), "hi", "token", (title) => titles.push(title));
    expect(store().messages.map((m) => m.id)).toEqual(["m"]);
    expect(store().streamingContent).toBe("");
    expect(store().isStreaming).toBe(false);
    expect(titles).toEqual(["Title"]);
  });

  it("finishes a network failure before response headers", async () => {
    globalThis.fetch = (async () => { throw new Error("Network failed"); }) as unknown as typeof fetch;
    await expect(run()).rejects.toThrow("Network failed");
    expect(store().isStreaming).toBe(false);
    expect(store().error).toBe("Network failed");
  });

  it("treats a server error as terminal without replacing it at EOF", async () => {
    serve(frame("error", { error: "Turn failed" }) + frame("text", "late"));
    await run();
    expect(store().isStreaming).toBe(false);
    expect(store().error).toBe("Turn failed");
    expect(store().streamingContent).toBe("");
  });
});


describe("streamChat rate-limit responses", () => {
  it.each([
    [RATE_LIMIT_ERROR_CODES.query, { limit: 50, used: 50 }, 50, "Daily query limit reached. Resets at midnight UTC."],
    [RATE_LIMIT_ERROR_CODES.cost, { cost_limit_microusd: 250000, cost_used_microusd: 250000 }, 250000, "Dollar usage budget reached. Resets when the active budget window resets."],
  ] as const)("classifies %s using the shared contract", async (code, usage, limit, message) => {
    globalThis.fetch = (async () => Response.json({ error: code, ...usage, resetAt: 1711497600 }, { status: 429 })) as unknown as typeof fetch;
    const error = await run().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ errorCode: code, limit, used: limit, resetAt: 1711497600, message });
  });

  it.each(["future_limit_exceeded", undefined, 42])("classifies unknown code %j without assuming a query limit", async (code) => {
    globalThis.fetch = (async () => Response.json({ error: code }, { status: 429 })) as unknown as typeof fetch;
    const error = await run().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ errorCode: undefined, message: "Request rate limit reached. Please try again later." });
  });

  it("preserves a server message for an unknown code", async () => {
    globalThis.fetch = (async () => Response.json({ error: "future_limit_exceeded", message: "Try again shortly." }, { status: 429 })) as unknown as typeof fetch;
    await expect(run()).rejects.toThrow("Try again shortly.");
  });

  it("keeps pricing configuration failures as server errors", async () => {
    globalThis.fetch = (async () => Response.json({ error: RATE_LIMIT_ERROR_CODES.pricing }, { status: 500 })) as unknown as typeof fetch;
    const error = await run().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ message: RATE_LIMIT_ERROR_CODES.pricing });
  });
});
