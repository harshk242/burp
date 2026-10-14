import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { useChatStore } from "@/stores/chatStore";
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
