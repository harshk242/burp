import { create } from "zustand";
import type { Message, ToolCall } from "@/types";
import { generateId } from "@/lib/id";
import { joinReasoning } from "@/lib/reasoning";

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  pendingToolCalls: ToolCall[];
  /** Reasoning text blocks accumulated during streaming (thinking + reclassified text) */
  reasoningSegments: string[];
  /**
   * Where each run of streamingContent began: `offset` into streamingContent and
   * `at`, the reasoningSegments index it precedes. Thinking that interleaves the
   * text splits it into runs, so reclassified text keeps its stream position.
   */
  textRuns: { at: number; offset: number }[];
  /** True while text deltas extend the last text run */
  textRunOpen: boolean;
  error: string | null;

  // Actions
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (id: string, updates: Partial<ToolCall>) => void;
  /**
   * Moves current streamingContent into reasoningSegments and resets it.
   * Called when text_block_end { isReasoning: true } is received — the streamed
   * text is reclassified as reasoning and collapses into the ReasoningBlock.
   */
  moveStreamingToReasoning: () => void;
  /**
   * Appends a thinking delta (`reasoning` SSE event). `newBlock` (first delta
   * of a thinking block) starts a new segment; otherwise it extends the last one.
   */
  appendReasoning: (chunk: string, newBlock: boolean) => void;
  finalizeAssistantMessage: () => void;
  /**
   * Patches tokenUsage onto the last assistant message in state.messages.
   * Must only be called AFTER finalizeAssistantMessage() (triggered by the
   * "done" SSE event). The "usage" SSE event arrives after "done", so by the
   * time this runs the target message is guaranteed to be in state.messages.
   */
  setLastMessageTokens: (input: number, output: number) => void;
  setError: (error: string | null) => void;
  setStreaming: (isStreaming: boolean) => void;
  resetStreamingState: () => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: "",
  pendingToolCalls: [],
  reasoningSegments: [],
  textRuns: [],
  textRunOpen: false,
  error: null,

  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateStreamingContent: (content) =>
    set({ streamingContent: content, isStreaming: true }),

  appendStreamingContent: (chunk) =>
    set((state) => {
      if (!chunk) return state;
      const textRuns = state.textRunOpen
        ? state.textRuns
        : [...state.textRuns, { at: state.reasoningSegments.length, offset: state.streamingContent.length }];
      return { streamingContent: state.streamingContent + chunk, textRuns, textRunOpen: true };
    }),

  addToolCall: (toolCall) =>
    set((state) => ({ pendingToolCalls: [...state.pendingToolCalls, toolCall] })),

  updateToolCall: (id, updates) =>
    set((state) => ({
      pendingToolCalls: state.pendingToolCalls.map((tc) =>
        tc.id === id ? { ...tc, ...updates } : tc
      ),
    })),

  moveStreamingToReasoning: () =>
    set((state) => {
      const { streamingContent: content, textRuns } = state;
      if (!content) return state;
      const runs = textRuns.length > 0 ? textRuns : [{ at: state.reasoningSegments.length, offset: 0 }];
      // Put each text run back before the thinking that followed it.
      const segments: string[] = [];
      let next = 0;
      const flushRunsAt = (at: number) => {
        for (; next < runs.length && runs[next].at <= at; next++) {
          segments.push(content.slice(runs[next].offset, runs[next + 1]?.offset ?? content.length));
        }
      };
      state.reasoningSegments.forEach((segment, i) => {
        flushRunsAt(i);
        segments.push(segment);
      });
      flushRunsAt(Infinity);
      return {
        reasoningSegments: segments,
        streamingContent: "",
        textRuns: [],
        textRunOpen: false,
      };
    }),

  appendReasoning: (chunk, newBlock) =>
    set((state) => {
      if (!chunk) return state;
      const segments = state.reasoningSegments;
      if (!newBlock && segments.length > 0) {
        return { reasoningSegments: [...segments.slice(0, -1), segments[segments.length - 1] + chunk] };
      }
      return { reasoningSegments: [...segments, chunk], textRunOpen: false };
    }),

  finalizeAssistantMessage: () => {
    const { streamingContent, pendingToolCalls, reasoningSegments } = get();
    if (streamingContent || pendingToolCalls.length > 0 || reasoningSegments.length > 0) {
      const reasoning = joinReasoning(reasoningSegments) || undefined;
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: generateId(),
            role: "assistant",
            content: streamingContent,
            toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
            createdAt: Date.now(),
            reasoning,
          },
        ],
        streamingContent: "",
        pendingToolCalls: [],
        reasoningSegments: [],
        textRuns: [],
        textRunOpen: false,
        isStreaming: false,
      }));
    }
  },

  setLastMessageTokens: (input, output) =>
    set((state) => {
      // Scan from the end to find the last assistant message
      const idx = [...state.messages].reverse().findIndex((m) => m.role === "assistant");
      if (idx === -1) return state;
      const realIdx = state.messages.length - 1 - idx;
      const updated = state.messages.map((m, i) =>
        i === realIdx ? { ...m, tokenUsage: { input, output } } : m
      );
      return { messages: updated };
    }),

  setError: (error) => set({ error, isStreaming: false }),

  setStreaming: (isStreaming) => set({ isStreaming }),

  // Reset only streaming state (call before each new message send)
  resetStreamingState: () =>
    set({
      streamingContent: "",
      pendingToolCalls: [],
      reasoningSegments: [],
      textRuns: [],
      textRunOpen: false,
      error: null,
      isStreaming: false,
    }),

  // Full reset including messages (call when switching sessions)
  reset: () =>
    set({
      messages: [],
      streamingContent: "",
      pendingToolCalls: [],
      reasoningSegments: [],
      textRuns: [],
      textRunOpen: false,
      error: null,
      isStreaming: false,
    }),
}));
