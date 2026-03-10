import { useChatStore } from "@/stores/chatStore";

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
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  // Track current event type from `event:` line
  let currentEventType: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        currentEventType = processSSELine(line, currentEventType, onTitle);
      }
    }

    // Drain any remaining data in the buffer after the stream closes.
    // This ensures the last SSE event (e.g., title) is never lost.
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        currentEventType = processSSELine(line, currentEventType, onTitle);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Process a single SSE line and return the updated event type.
 */
function processSSELine(
  line: string,
  currentEventType: string | null,
  onTitle?: (title: string) => void
): string | null {
  // Standard SSE format: backend sends "event: <type>" then "data: <payload>"
  if (line.startsWith("event: ")) {
    return line.slice(7).trim();
  }

  if (line.startsWith("data: ")) {
    const payload = line.slice(6);
    if (payload && currentEventType) {
      try {
        const data = JSON.parse(payload);
        handleSSEEvent(currentEventType, data, onTitle);
      } catch {
        // Handle non-JSON data (e.g., plain text chunks)
        handleSSEEvent(currentEventType, payload, onTitle);
      }
    }
    // Reset event type after processing (SSE events are paired)
    return null;
  }

  // Empty line marks end of an event block (SSE spec)
  if (line === "") {
    return null;
  }

  return currentEventType;
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
