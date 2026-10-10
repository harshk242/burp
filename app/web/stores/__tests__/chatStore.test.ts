import { beforeEach, describe, expect, it } from "bun:test";
import { useChatStore } from "../chatStore";

const store = () => useChatStore.getState();

beforeEach(() => store().reset());

describe("chatStore reasoning", () => {
  it("appends reasoning deltas to one open segment", () => {
    store().appendReasoning("Let me ");
    store().appendReasoning("think.");
    expect(store().reasoningSegments).toEqual(["Let me think."]);
  });

  it("ignores empty reasoning deltas", () => {
    store().appendReasoning("");
    expect(store().reasoningSegments).toEqual([]);
  });

  it("keeps thinking and reclassified pre-tool text as segments in stream order", () => {
    // Call 1: thinking, pre-tool text, tool call. Call 2: thinking, final text.
    store().appendReasoning("Plan A.");
    store().appendStreamingContent("Looking it up.");
    store().moveStreamingToReasoning();
    store().addToolCall({ id: "c1", name: "t", server: "s", toolName: "t", input: {}, status: "running" });
    store().appendReasoning("Got ");
    store().appendReasoning("it.");
    store().appendStreamingContent("Final");

    expect(store().reasoningSegments).toEqual(["Plan A.", "Looking it up.", "Got it."]);
    expect(store().streamingContent).toBe("Final");
  });

  it("starts a new segment for thinking after a tool call without text", () => {
    store().appendReasoning("First.");
    store().addToolCall({ id: "c1", name: "t", server: "s", toolName: "t", input: {}, status: "running" });
    store().appendReasoning("Second.");
    expect(store().reasoningSegments).toEqual(["First.", "Second."]);
  });

  it("finalizes the joined reasoning onto the assistant message", () => {
    store().appendReasoning("Plan A.");
    store().appendStreamingContent("Pre.");
    store().moveStreamingToReasoning();
    store().appendStreamingContent("Answer");
    store().finalizeAssistantMessage();

    const [message] = store().messages;
    expect(message).toMatchObject({ role: "assistant", content: "Answer", reasoning: "Plan A.\n\nPre." });
    expect(store().reasoningSegments).toEqual([]);
    expect(store().reasoningOpen).toBe(false);
  });

  it("leaves reasoning undefined when the model didn't think", () => {
    store().appendStreamingContent("Plain");
    store().finalizeAssistantMessage();
    expect(store().messages[0]?.reasoning).toBeUndefined();
  });
});
