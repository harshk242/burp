import type { ChatState } from "@/stores/chatStore";
import { RateLimitError } from "@/types";
import { isRateLimitErrorCode, RATE_LIMIT_ERROR_CODES } from "../../shared/rate-limit";
import type { ChatCompletion } from "../../shared/chat";
import { asRecord, optString } from "../../shared/json";

/** JSON error body of a failed chat request; 429s carry the rate-limit fields. */
interface ErrorBody {
  error?: string | undefined;
  message?: string | undefined;
  limit?: number | undefined;
  used?: number | undefined;
  cost_limit_microusd?: number | undefined;
  cost_used_microusd?: number | undefined;
  resetAt?: number | undefined;
}

const optNumber = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

function errorBody(value: unknown): ErrorBody {
  const body = asRecord(value);
  return {
    error: optString(body.error),
    message: optString(body.message),
    limit: optNumber(body.limit),
    used: optNumber(body.used),
    cost_limit_microusd: optNumber(body.cost_limit_microusd),
    cost_used_microusd: optNumber(body.cost_used_microusd),
    resetAt: optNumber(body.resetAt),
  };
}

export interface StreamOwner {
  signal: AbortSignal;
  isCurrent: () => boolean;
  commit: (commit: (store: ChatState) => void) => boolean;
}
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export async function streamChat(
  sessionId: string,
  message: string,
  token: string | null,
  owner: StreamOwner,
  onTitle?: (title: string) => void
): Promise<void> {
  try {
    await consumeChat(sessionId, message, token, owner, onTitle);
  } catch (error) {
    if (!owner.isCurrent()) return;
    owner.commit((store) => store.setError(error instanceof Error ? error.message : "Stream failed"));
    throw error;
  }
}

async function consumeChat(
  sessionId: string, message: string, token: string | null, owner: StreamOwner,
  onTitle?: (title: string) => void
): Promise<void> {
  if (!owner.isCurrent()) return;

  const response = await fetch(`${API_BASE}/api/chat`, {
    signal: owner.signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!owner.isCurrent()) {
    await response.body?.cancel();
    return;
  }

  if (!response.ok) {
    const error = errorBody(await response.json().catch(() => ({ error: "Request failed" })));
    if (response.status === 429) {
      const errorCode = isRateLimitErrorCode(error.error) ? error.error : undefined;
      let message: string;
      if (errorCode === RATE_LIMIT_ERROR_CODES.cost) {
        message = error.message || "Dollar usage budget reached. Resets when the active budget window resets.";
      } else if (errorCode === RATE_LIMIT_ERROR_CODES.query) {
        message = error.message || "Daily query limit reached. Resets at midnight UTC.";
      } else {
        message = error.message || "Request rate limit reached. Please try again later.";
      }
      throw new RateLimitError(
        message,
        error.limit ?? error.cost_limit_microusd ?? 0,
        error.used ?? error.cost_used_microusd ?? 0,
        error.resetAt ?? 0,
        errorCode
      );
    }
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const cancel = () => { void reader.cancel().catch(() => {}); };
  owner.signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;

  let currentEventType: string | null = null;
  let dataLines: string[] = [];

  function dispatchEvent() {
    if (currentEventType && dataLines.length > 0) {
      const data = decodeSSEData(currentEventType, dataLines.join("\n"));
      if (data !== undefined && owner.isCurrent() && (!terminal || currentEventType === "title")) {
        owner.commit((store) => {
          terminal = handleSSEEvent(store, currentEventType!, data, onTitle) || terminal;
        });
      }
    }
    currentEventType = null;
    dataLines = [];
  }

  function processLine(line: string) {
    if (line.startsWith("event: ")) {
      currentEventType = line.slice(7).trim();
    } else if (line.startsWith("data:")) {
      const payload = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      dataLines.push(payload);
    } else if (line === "") {
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

    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        processLine(line);
      }
    }
    dispatchEvent();
    if (!terminal) {
      owner.commit((store) => store.setError("Response interrupted before completion"));
    }
  } catch (error) {
    if (!terminal) throw error;
  } finally {
    owner.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export function decodeSSEData(eventType: string, payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    console.warn(`Malformed SSE payload for "${eventType}"`, payload);
    return undefined;
  }
}

function handleSSEEvent(
  store: ChatState,
  eventType: string,
  data: unknown,
  onTitle?: (title: string) => void
): boolean {
  switch (eventType) {
    case "start":
      store.updateStreamingContent("");
      break;

    case "text":
      if (typeof data === "string") store.appendStreamingContent(data);
      break;

    case "tool_start": {
      const toolStart = asRecord(data);
      if (typeof toolStart.id !== "string") break;
      store.addToolCall({
        id: toolStart.id,
        name: optString(toolStart.tool) ?? "",
        server: optString(toolStart.server) ?? "",
        toolName: optString(toolStart.toolName) ?? "",
        input: asRecord(toolStart.input),
        status: "running",
      });
      break;
    }

    case "tool_end": {
      const toolEnd = asRecord(data);
      if (typeof toolEnd.id !== "string") break;
      const error = optString(toolEnd.error);
      store.updateToolCall(toolEnd.id, {
        output: toolEnd.output,
        error,
        status: error ? "error" : "complete",
      });
      break;
    }

    case "title": {
      const title =
        typeof data === "string" ? data : optString(asRecord(data).title) || "";
      if (onTitle && title) onTitle(title);
      break;
    }

    case "text_block_end": {
      if (asRecord(data).isReasoning === true) {
        store.moveStreamingToReasoning();
      }
      break;
    }

    case "reasoning": {
      const { text, newBlock } = asRecord(data);
      if (typeof text === "string") store.appendReasoning(text, newBlock === true);
      break;
    }

    case "done": {
      const completion = (data ?? {}) as Partial<ChatCompletion>;
      if (typeof completion.messageId !== "string" ||
          typeof completion.inputTokens !== "number" || typeof completion.outputTokens !== "number") {
        return false;
      }
      store.finalizeAssistantMessage(completion.messageId, {
        input: completion.inputTokens, output: completion.outputTokens,
      });
      return true;
    }

    case "error": {
      const errorMsg =
        typeof data === "string"
          ? data
          : optString(asRecord(data).error) || "Unknown error";
      store.setError(errorMsg);
      return true;
    }

    default:
      console.warn(`Unknown SSE event type: ${eventType}`, data);
  }
  return false;
}
