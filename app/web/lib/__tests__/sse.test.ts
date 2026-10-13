import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { useChatStore } from "@/stores/chatStore";
import { streamChat } from "../sse";

const store = () => useChatStore.getState();
const realFetch = globalThis.fetch;

/** An SSE frame as the server writes it: every payload JSON (server/routes/sse-encode.ts). */
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Serves `body` in chunks of `chunkSize` bytes, so frames split across reads. */
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

    await streamChat("s1", "hi", "token");

    expect(store().streamingContent).toBe(chunks.join(""));
  });

  it("finalizes a message whose whole content is a numeric chunk", async () => {
    serve(frame("text", "42") + frame("done", { messageId: "m1" }) + frame("usage", { inputTokens: 1, outputTokens: 2 }));

    await streamChat("s1", "hi", "token");

    expect(store().messages).toHaveLength(1);
    expect(store().messages[0]).toMatchObject({ id: "m1", persisted: true, role: "assistant", content: "42", tokenUsage: { input: 1, output: 2 } });
  });

  it("keeps numeric-looking reasoning deltas", async () => {
    serve(frame("reasoning", { text: "42", newBlock: true }) + frame("reasoning", { text: " ", newBlock: false }) + frame("reasoning", { text: "null", newBlock: false }));

    await streamChat("s1", "hi", "token");

    expect(store().reasoningSegments).toEqual(["42 null"]);
  });

  it("drops a payload that isn't JSON instead of guessing", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    serve("event: text\ndata: not json\n\n" + frame("text", "ok"));

    await streamChat("s1", "hi", "token");

    expect(store().streamingContent).toBe("ok");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
