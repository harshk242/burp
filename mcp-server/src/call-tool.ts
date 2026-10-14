import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { UpstreamError } from './shared/exceptions.js';
import { REASON_TO_KIND, type UpstreamReason } from './shared/http-retry-classify.js';
import { resolveToolCallTimeoutMs, runWithToolCallContext } from './shared/tool-call-context.js';
import type { ToolHandler } from './types.js';

const SERVER_HARD_CAP_BYTES = parseInt(
  process.env.MCP_SERVER_HARD_CAP_BYTES ?? '5242880',
  10,
);

export interface CallToolExtra {
  signal: AbortSignal;
}

/** Agent-facing JSON for an `UpstreamError`. Every field is always present. */
export interface UpstreamErrorPayload {
  error: string;
  reason: string;
  platform: string;
  status: number | null;
  attempts: number;
  elapsed_ms: number;
  retry_after_ms: number | null;
  retryable_later: boolean | null;
  message: string;
}

export function upstreamErrorPayload(error: UpstreamError): UpstreamErrorPayload {
  const info = Object.hasOwn(REASON_TO_KIND, error.reason)
    ? REASON_TO_KIND[error.reason as UpstreamReason]
    : undefined;
  const hint = info?.hint;
  const message = hint && !error.message.includes(hint) ? `${error.message} ${hint}` : error.message;
  return {
    error: info?.kind ?? error.kind,
    reason: error.reason,
    platform: error.platform,
    status: error.status ?? null,
    attempts: error.attempts,
    elapsed_ms: error.elapsedMs,
    retry_after_ms: error.retryAfterMs ?? null,
    retryable_later: info?.retryableLater ?? null,
    message,
  };
}

function errorResult(error: unknown): CallToolResult {
  const text = error instanceof UpstreamError
    ? JSON.stringify(upstreamErrorPayload(error))
    : `Error: ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: 'text', text }], isError: true };
}

async function runTool(name: string, handler: ToolHandler, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const result = await handler(args);
    const serialized = JSON.stringify(result, null, 2);
    const sizeBytes = Buffer.byteLength(serialized, 'utf-8');

    if (sizeBytes > SERVER_HARD_CAP_BYTES) {
      const actualMB = (sizeBytes / 1024 / 1024).toFixed(2);
      const capMB = (SERVER_HARD_CAP_BYTES / 1024 / 1024).toFixed(1);
      console.error(
        `[WARN] Tool "${name}" output ${actualMB}MB exceeds server hard cap ${capMB}MB — returning error instead`,
      );
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'output_too_large',
            tool: name,
            output_bytes: sizeBytes,
            cap_bytes: SERVER_HARD_CAP_BYTES,
            message: `Tool "${name}" returned ${actualMB}MB which exceeds the server-side ${capMB}MB safety cap. The data was NOT truncated — nothing was sent. To fix: use more specific query parameters (e.g., smaller 'size', narrower filters) to reduce the result set.`,
          }),
        }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: serialized }],
    };
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * Builds the CallTool request handler. The tool-call deadline is the client's
 * `_meta.deadline_ms` minus a margin (55s when missing); `extra.signal` cancels.
 */
export function createCallToolHandler(allHandlers: Map<string, ToolHandler>) {
  return async (request: CallToolRequest, extra: CallToolExtra): Promise<CallToolResult> => {
    const { name, arguments: args, _meta } = request.params;
    const handler = allHandlers.get(name);

    if (!handler) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const timeoutMs = resolveToolCallTimeoutMs((_meta as Record<string, unknown> | undefined)?.deadline_ms);
    return runWithToolCallContext({ timeoutMs, signal: extra.signal }, async (context) => {
      const result = await runTool(name, handler, args ?? {});
      const retry = context.buildRetryMeta({ isError: result.isError === true });
      return retry ? { ...result, _meta: { ...result._meta, retry } } : result;
    });
  };
}
