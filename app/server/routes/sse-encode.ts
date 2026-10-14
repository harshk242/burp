/**
 * Chat SSE wire format: every event's `data` is JSON, strings included.
 */

import type { StreamEvent } from "../orchestration/types";

export interface SSEMessage {
  event: string;
  data: string;
}

export function encodeSSE(event: StreamEvent["type"] | "title", data: unknown): SSEMessage {
  return { event, data: JSON.stringify(data) };
}
