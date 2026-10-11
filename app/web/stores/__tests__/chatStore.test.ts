import { beforeEach, describe, expect, it } from "bun:test";
import { useChatStore } from "../chatStore";

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
