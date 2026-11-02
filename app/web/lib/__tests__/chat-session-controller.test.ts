import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ChatSessionController } from "../chat-session-controller";
import { useChatStore } from "@/stores/chatStore";
import type { SessionWithMessagesResponse } from "@/types";

const store = () => useChatStore.getState();
const realFetch = globalThis.fetch;
const history = (id: string): SessionWithMessagesResponse => ({
  session: { id, user_id: "u", title: id, created_at: 1, updated_at: null },
  messages: [{ id: `${id}-message`, chat_id: id, role: "assistant", content: id, tool_calls: null, created_at: 1 }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
beforeEach(() => store().reset());
afterEach(() => { globalThis.fetch = realFetch; });

describe("ChatSessionController ownership", () => {
  it("aborts A history and ignores its delayed response after selecting B", async () => {
    const controller = new ChatSessionController();
    const a = controller.select("a");
    const response = deferred<SessionWithMessagesResponse>();
    const loadingA = controller.loadHistory(a, (_, options) => {
      expect(options.signal).toBe(a.signal);
      return response.promise;
    });
    const b = controller.select("b");
    await controller.loadHistory(b, async () => history("b"));
    response.resolve(history("a"));
    await loadingA;
    expect(a.signal.aborted).toBe(true);
    expect(store().messages.map((m) => m.id)).toEqual(["b-message"]);
    expect(store().error).toBeNull();
  });

  it("ignores stale history failures and obsolete history on returning to the same session", async () => {
    const controller = new ChatSessionController();
    const a = controller.select("a");
    const response = deferred<SessionWithMessagesResponse>();
    const loading = controller.loadHistory(a, () => response.promise);
    controller.select("b");
    const current = controller.select("a");
    await controller.loadHistory(current, async () => history("a"));
    response.reject(new Error("late failure"));
    await loading;
    expect(store().messages.map((m) => m.id)).toEqual(["a-message"]);
    expect(store().error).toBeNull();
  });

  it("aborts a deselected stream and ignores delayed frames and title even if fetch ignores abort", async () => {
    const controller = new ChatSessionController();
    controller.select("a");
    const turn = controller.beginTurn("a");
    const response = deferred<Response>();
    globalThis.fetch = (async (_: RequestInfo | URL, options?: RequestInit) => {
      expect(options?.signal).toBe(turn.signal);
      return response.promise;
    }) as unknown as typeof fetch;
    const titles: string[] = [];
    const streaming = controller.stream(turn, "hi", "token", (title) => titles.push(title));
    const b = controller.select("b");
    await controller.loadHistory(b, async () => history("b"));
    response.resolve(new Response('event: text\ndata: "stale"\n\nevent: done\ndata: {"messageId":"stale","inputTokens":9,"outputTokens":9}\n\nevent: title\ndata: {"title":"stale"}\n\n'));
    await streaming;
    expect(turn.signal.aborted).toBe(true);
    expect(store().messages.map((m) => m.id)).toEqual(["b-message"]);
    expect(store().streamingContent).toBe("");
    expect(store().isStreaming).toBe(false);
    expect(store().error).toBeNull();
    expect(titles).toEqual([]);
  });

  it("cancels the response reader when a running stream is deselected", async () => {
    const controller = new ChatSessionController();
    controller.select("a");
    const started = deferred<void>();
    let canceled = false;
    globalThis.fetch = (async () => new Response(new ReadableStream({
      pull() { started.resolve(); },
      cancel() { canceled = true; },
    }))) as unknown as typeof fetch;
    const streaming = controller.stream(controller.beginTurn("a"), "hi", "token", () => {});
    await started.promise;
    await Promise.resolve();
    controller.select("b");
    await streaming;
    expect(canceled).toBe(true);
    expect(store().error).toBeNull();
    expect(store().isStreaming).toBe(false);
  });

  it("keys commits by turn and adopts a created session without losing its pending turn", () => {
    const controller = new ChatSessionController();
    controller.select(null);
    const pending = controller.beginTurn(null);
    const adopted = controller.adoptSession(pending, "created")!;
    expect(controller.selected("created")).toBe(true);
    expect(adopted.owner.turnId).toBe(pending.owner.turnId);
    expect(store().isStreaming).toBe(true);
    expect(pending.commit((state) => state.setError("stale"))).toBe(false);
    const next = controller.beginTurn("created");
    expect(adopted.commit((state) => state.finalizeAssistantMessage("old"))).toBe(false);
    expect(next.commit((state) => state.finalizeAssistantMessage("new"))).toBe(true);
    expect(store().messages.map((m) => m.id)).toEqual(["new"]);
  });

  it("cancels session creation ownership and turn work on disposal", () => {
    const controller = new ChatSessionController();
    controller.select(null);
    const pending = controller.beginTurn(null);
    controller.dispose();
    expect(controller.adoptSession(pending, "late")).toBeNull();
    expect(pending.signal.aborted).toBe(true);
    expect(store().isStreaming).toBe(false);
  });
});
