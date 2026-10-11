/**
 * Chat SSE wire format: every event's `data` is JSON, strings included.
 *
 * A bare string payload is ambiguous to a client that JSON-decodes: a text
 * chunk "42", "true" or "null" would decode to a number, boolean or null, and
 * Hono splits raw data on \r and \n, so "\r\n" would come back as "\n".
 * JSON-encoding every payload keeps it on one `data:` line and round-trips it
 * exactly. app/web/lib/sse.ts decodes with JSON.parse.
 */

import type { StreamEvent } from "../orchestration/types";

export interface SSEMessage {
  event: string;
  data: string;
}

export function encodeSSE(event: StreamEvent["type"] | "title", data: unknown): SSEMessage {
  return { event, data: JSON.stringify(data) };
}
