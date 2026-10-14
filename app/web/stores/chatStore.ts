import { create } from "zustand";
import type { Feedback, Message, ToolCall } from "@/types";
import { generateId } from "@/lib/id";
import { joinReasoning } from "@/lib/reasoning";

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  pendingToolCalls: ToolCall[];
  reasoningSegments: string[];
  textRuns: { at: number; offset: number }[];
  textRunOpen: boolean;
  error: string | null;

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
  /**
   * Commits the streamed turn as an assistant message. `messageId` (from the
   * done event) is the server's id; without it the message can't take feedback.
   */
  finalizeAssistantMessage: (messageId?: string) => void;
  /** Sets (or clears, with null) the user's feedback on a message. */
  setFeedback: (messageId: string, feedback: Feedback | null) => void;
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

  finalizeAssistantMessage: (messageId) => {
    const { streamingContent, pendingToolCalls, reasoningSegments } = get();
    if (streamingContent || pendingToolCalls.length > 0 || reasoningSegments.length > 0) {
      const reasoning = joinReasoning(reasoningSegments) || undefined;
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: messageId ?? generateId(),
            persisted: messageId !== undefined,
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

  setFeedback: (messageId, feedback) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === messageId ? { ...m, feedback } : m)),
    })),

  setLastMessageTokens: (input, output) =>
    set((state) => {
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
