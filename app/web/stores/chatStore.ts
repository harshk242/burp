import { create } from "zustand";
import type { Message, ToolCall } from "@/types";

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  pendingToolCalls: ToolCall[];
  error: string | null;

  // Actions
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (id: string, updates: Partial<ToolCall>) => void;
  finalizeAssistantMessage: () => void;
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
  error: null,

  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateStreamingContent: (content) =>
    set({ streamingContent: content, isStreaming: true }),

  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),

  addToolCall: (toolCall) =>
    set((state) => ({ pendingToolCalls: [...state.pendingToolCalls, toolCall] })),

  updateToolCall: (id, updates) =>
    set((state) => ({
      pendingToolCalls: state.pendingToolCalls.map((tc) =>
        tc.id === id ? { ...tc, ...updates } : tc
      ),
    })),

  finalizeAssistantMessage: () => {
    const { streamingContent, pendingToolCalls } = get();
    if (streamingContent || pendingToolCalls.length > 0) {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: streamingContent,
            toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
            createdAt: Date.now(),
          },
        ],
        streamingContent: "",
        pendingToolCalls: [],
        isStreaming: false,
      }));
    }
  },

  setError: (error) => set({ error, isStreaming: false }),

  setStreaming: (isStreaming) => set({ isStreaming }),

  // Reset only streaming state (call before each new message send)
  resetStreamingState: () =>
    set({
      streamingContent: "",
      pendingToolCalls: [],
      error: null,
      isStreaming: false,
    }),

  // Full reset including messages (call when switching sessions)
  reset: () =>
    set({
      messages: [],
      streamingContent: "",
      pendingToolCalls: [],
      error: null,
      isStreaming: false,
    }),
}));
