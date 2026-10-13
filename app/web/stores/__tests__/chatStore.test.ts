import { beforeEach, describe, expect, it } from "bun:test";
import { useChatStore } from "../chatStore";
import { dbMessageToMessage } from "@/lib/history";
import type { DbMessage, Message } from "@/types";

const store = () => useChatStore.getState();

beforeEach(() => store().reset());

describe("chatStore reasoning", () => {
  it("appends reasoning deltas to the block's segment", () => {
    store().appendReasoning("Let me ", true);
    store().appendReasoning("think.", false);
    expect(store().reasoningSegments).toEqual(["Let me think."]);
  });

  it("ignores empty reasoning deltas", () => {
    store().appendReasoning("", true);
    expect(store().reasoningSegments).toEqual([]);
  });

  it("keeps thinking and reclassified pre-tool text as segments in stream order", () => {
    // Call 1: thinking, pre-tool text, tool call. Call 2: thinking, final text.
    store().appendReasoning("Plan A.", true);
    store().appendStreamingContent("Looking it up.");
    store().moveStreamingToReasoning();
    store().addToolCall({ id: "c1", name: "t", server: "s", toolName: "t", input: {}, status: "running" });
    store().appendReasoning("Got ", true);
    store().appendReasoning("it.", false);
    store().appendStreamingContent("Final");

    expect(store().reasoningSegments).toEqual(["Plan A.", "Looking it up.", "Got it."]);
    expect(store().streamingContent).toBe("Final");
  });

  it("starts a new segment for each thinking block", () => {
    store().appendReasoning("First.", true);
    store().addToolCall({ id: "c1", name: "t", server: "s", toolName: "t", input: {}, status: "running" });
    store().appendReasoning("Second.", true);
    store().appendReasoning("Third.", true);
    expect(store().reasoningSegments).toEqual(["First.", "Second.", "Third."]);
  });

  it("reclassifies text interleaved with thinking in stream order", () => {
    // Call: thinking A, text, thinking B, text, tool call.
    store().appendReasoning("A.", true);
    store().appendStreamingContent("Check");
    store().appendStreamingContent("ing.");
    store().appendReasoning("B.", true);
    store().appendStreamingContent("More.");
    expect(store().reasoningSegments).toEqual(["A.", "B."]);

    store().moveStreamingToReasoning();
    expect(store().reasoningSegments).toEqual(["A.", "Checking.", "B.", "More."]);
    expect(store().streamingContent).toBe("");

    // The next call's text starts a fresh run.
    store().appendStreamingContent("Final");
    store().finalizeAssistantMessage();
    expect(store().messages[0]).toMatchObject({ content: "Final", reasoning: "A.\n\nChecking.\n\nB.\n\nMore." });
  });

  it("finalizes the joined reasoning onto the assistant message", () => {
    store().appendReasoning("Plan A.", true);
    store().appendStreamingContent("Pre.");
    store().moveStreamingToReasoning();
    store().appendStreamingContent("Answer");
    store().finalizeAssistantMessage();

    const [message] = store().messages;
    expect(message).toMatchObject({ role: "assistant", content: "Answer", reasoning: "Plan A.\n\nPre." });
    expect(store().reasoningSegments).toEqual([]);
    expect(store().textRuns).toEqual([]);
  });

  it("doesn't stack blank lines when summaries already end in one (matches stored reasoning)", () => {
    // Same stream as the server's chat-reasoning test of the same name.
    const tool = (id: string) => ({ id, name: "t", server: "s", toolName: "t", input: {}, status: "running" as const });
    store().appendReasoning("Plan A.\n\n", true);
    store().appendStreamingContent("\n");
    store().moveStreamingToReasoning();
    store().addToolCall(tool("c1"));
    store().appendReasoning("\nPlan B.\n\n", true);
    store().appendStreamingContent("Looking.\n\n");
    store().moveStreamingToReasoning();
    store().addToolCall(tool("c2"));
    store().appendReasoning("Got it.\n\n", true);
    store().appendStreamingContent("Final");
    store().finalizeAssistantMessage();

    expect(store().messages[0]?.reasoning).toBe("Plan A.\n\nPlan B.\n\nLooking.\n\nGot it.");
  });

  it("leaves reasoning undefined when the model didn't think", () => {
    store().appendStreamingContent("Plain");
    store().finalizeAssistantMessage();
    expect(store().messages[0]?.reasoning).toBeUndefined();
  });
});

describe("chatStore feedback", () => {
  const assistant = (id: string, extra: Partial<Message> = {}): Message => ({
    id,
    role: "assistant",
    content: "answer",
    createdAt: 1,
    persisted: true,
    ...extra,
  });

  it("finalizes under the server's message id so feedback can target it", () => {
    store().appendStreamingContent("Answer");
    store().finalizeAssistantMessage("srv-1");
    expect(store().messages[0]).toMatchObject({ id: "srv-1", persisted: true });
  });

  it("marks a message finalized without a server id as not persisted", () => {
    store().appendStreamingContent("Answer");
    store().finalizeAssistantMessage();
    expect(store().messages[0]?.persisted).toBe(false);
    expect(store().messages[0]?.id).toBeTruthy();
  });

  it("sets, replaces and clears feedback on the target message only", () => {
    store().setMessages([assistant("a"), assistant("b", { feedback: { value: 1, comment: null, categories: [] } })]);
    store().setFeedback("a", { value: 0, comment: "wrong gene", categories: ["factually_incorrect"] });
    expect(store().messages.map((m) => m.feedback)).toEqual([
      { value: 0, comment: "wrong gene", categories: ["factually_incorrect"] },
      { value: 1, comment: null, categories: [] },
    ]);
    store().setFeedback("a", { value: 1, comment: null, categories: [] });
    expect(store().messages[0]?.feedback).toEqual({ value: 1, comment: null, categories: [] });
    store().setFeedback("b", null);
    expect(store().messages[1]?.feedback).toBeNull();
  });

  it("round-trips feedback categories from session history through the store", () => {
    const row: DbMessage = {
      id: "a",
      chat_id: "chat",
      role: "assistant",
      content: "answer",
      tool_calls: null,
      created_at: 1,
      feedback: { value: 1, comment: "great", categories: ["accurate", "well_sourced"] },
    };
    store().setMessages([dbMessageToMessage(row), dbMessageToMessage({ ...row, id: "b", feedback: null })]);
    expect(store().messages.map((m) => m.feedback)).toEqual([
      { value: 1, comment: "great", categories: ["accurate", "well_sourced"] },
      null,
    ]);
    // A thumb flip saves categories: [] and replaces the old polarity's.
    store().setFeedback("a", { value: 0, comment: null, categories: [] });
    expect(store().messages[0]?.feedback).toEqual({ value: 0, comment: null, categories: [] });
    store().setFeedback("a", { value: 0, comment: null, categories: ["incomplete", "outdated"] });
    expect(store().messages[0]?.feedback?.categories).toEqual(["incomplete", "outdated"]);
  });

  it("keeps loaded feedback until the session is reset", () => {
    store().setMessages([assistant("a", { feedback: { value: 0, comment: null, categories: [] } })]);
    store().appendStreamingContent("next");
    store().finalizeAssistantMessage("b");
    expect(store().messages[0]?.feedback).toEqual({ value: 0, comment: null, categories: [] });
    store().reset();
    expect(store().messages).toEqual([]);
  });
});
