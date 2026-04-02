import { useChatStore } from "@/stores/chatStore";
import { RateLimitError } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export async function streamChat(
  sessionId: string,
  message: string,
  token: string,
  onTitle?: (title: string) => void
): Promise<void> {
  const store = useChatStore.getState();
  // Only reset streaming state, NOT messages (keep conversation history)
  store.resetStreamingState();
  store.setStreaming(true);

  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!response.ok) {
    store.setStreaming(false);
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    if (response.status === 429) {
      const errorCode: string = error.error ?? "";
      let message: string;
      if (errorCode === "token_limit_exceeded") {
        message = error.message || `Daily token budget of ${(error.token_limit ?? 0).toLocaleString()} tokens reached. Resets at midnight UTC.`;
      } else {
        message = error.message || "Daily query limit reached. Resets at midnight UTC.";
      }
      throw new RateLimitError(
        message,
        error.limit ?? error.token_limit ?? 0,
        error.used ?? error.tokens_used ?? 0,
        error.resetAt ?? 0,
        errorCode
      );
    }
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    store.setStreaming(false);
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  // SSE spec: accumulate data lines per event, dispatch on empty line boundary
  let currentEventType: string | null = null;
  let dataLines: string[] = [];

  function dispatchEvent() {
    if (currentEventType && dataLines.length > 0) {
      const fullPayload = dataLines.join("\n");
      try {
        const data = JSON.parse(fullPayload);
        handleSSEEvent(currentEventType, data, onTitle);
      } catch {
        handleSSEEvent(currentEventType, fullPayload, onTitle);
      }
    }
    currentEventType = null;
    dataLines = [];
  }

  function processLine(line: string) {
    if (line.startsWith("event: ")) {
      currentEventType = line.slice(7).trim();
    } else if (line.startsWith("data:")) {
      // "data: content" (with space) or "data:" (empty / no space)
      const payload = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      dataLines.push(payload);
    } else if (line === "") {
      // Empty line = end of event block per SSE spec
      dispatchEvent();
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        processLine(line);
      }
    }

    // Drain any remaining data in the buffer after the stream closes.
    // This ensures the last SSE event (e.g., title) is never lost.
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        processLine(line);
      }
    }
    // Flush any pending event that wasn't terminated by an empty line
    dispatchEvent();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Handle a single SSE event.
 * @param eventType - The event type from the `event:` line
 * @param data - The parsed payload from the `data:` line
 */
function handleSSEEvent(
  eventType: string,
  data: unknown,
  onTitle?: (title: string) => void
) {
  const store = useChatStore.getState();

  switch (eventType) {
    case "start":
      store.updateStreamingContent("");
      break;

    case "text": {
      // Text chunks can be string or object with content
      const text =
        typeof data === "string"
          ? data
          : (data as { content?: string }).content || "";
      store.appendStreamingContent(text);
      break;
    }

    case "tool_start": {
      const toolStart = data as {
        id: string;
        tool: string;
        server: string;
        toolName: string;
        input: Record<string, unknown>;
      };
      store.addToolCall({
        id: toolStart.id,
        name: toolStart.tool,
        server: toolStart.server,
        toolName: toolStart.toolName,
        input: toolStart.input,
        status: "running",
      });
      break;
    }

    case "tool_end": {
      const toolEnd = data as {
        id: string;
        output?: unknown;
        error?: string;
      };
      store.updateToolCall(toolEnd.id, {
        output: toolEnd.output,
        error: toolEnd.error,
        status: toolEnd.error ? "error" : "complete",
      });
      break;
    }

    case "title": {
      const title =
        typeof data === "string" ? data : (data as { title?: string }).title || "";
      if (onTitle && title) onTitle(title);
      break;
    }

    case "done":
      store.finalizeAssistantMessage();
      break;

    case "usage": {
      // Arrives after "done" — finalizeAssistantMessage() has already committed
      // the assistant message to state.messages, so patching tokenUsage is safe.
      const { inputTokens, outputTokens } = data as { inputTokens: number; outputTokens: number };
      store.setLastMessageTokens(inputTokens, outputTokens);
      break;
    }

    case "error": {
      const errorMsg =
        typeof data === "string"
          ? data
          : (data as { error?: string }).error || "Unknown error";
      store.setError(errorMsg);
      break;
    }

    default:
      console.warn(`Unknown SSE event type: ${eventType}`, data);
  }
}
