// Stub Axios adapter and helpers for the shared HTTP retry unit tests (no network).

import axios, {
  AxiosError,
  AxiosHeaders,
  CanceledError,
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createCallToolHandler } from '../../call-tool.js';
import type { ToolHandler } from '../../types.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../http-retry.js';

export type Step =
  | number
  | 'network'
  | 'timeout'
  | 'hang'
  | { status: number; headers?: Record<string, string>; delayMs?: number; advanceMs?: number };

export function axiosFailure(options: {
  code?: string;
  message?: string;
  status?: number;
  headers?: Record<string, string>;
}): AxiosError {
  const error = new AxiosError(options.message ?? 'request failed', options.code);
  if (options.status !== undefined) {
    error.response = {
      data: undefined,
      status: options.status,
      statusText: 'Error',
      headers: options.headers ?? {},
      config: error.config!,
    };
  }
  return error;
}

export interface FakeClock {
  now: () => number;
  advance: (ms: number) => void;
}

export function fakeClock(start = 1_000_000): FakeClock {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function waitOrAbort(ms: number, config: InternalAxiosRequestConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const signal = config.signal as AbortSignal | undefined;
    const cancel = () => reject(new CanceledError(undefined, undefined, config));
    if (signal?.aborted) return cancel();
    const timeout = config.timeout && config.timeout > 0 ? config.timeout : Infinity;
    const timer = Number.isFinite(ms) ? setTimeout(resolve, ms) : undefined;
    const attemptTimer = Number.isFinite(timeout) && timeout < ms
      ? setTimeout(() => reject(new AxiosError('timeout exceeded', 'ECONNABORTED', config)), timeout)
      : undefined;
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      clearTimeout(attemptTimer);
      cancel();
    }, { once: true });
  });
}

/**
 * Adapter that plays `steps` in order (the last step repeats) and records each
 * call's config. Numbers are HTTP statuses; 'hang' waits until aborted.
 */
export function stubAdapter(steps: Step[], clock?: FakeClock) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === 'network') throw new AxiosError('socket hang up', 'ECONNRESET', config);
    if (step === 'timeout') throw new AxiosError('timeout exceeded', 'ECONNABORTED', config);
    if (step === 'hang') {
      await waitOrAbort(Infinity, config);
      throw new Error('unreachable');
    }
    const spec = typeof step === 'number' ? { status: step } : step;
    if (spec.delayMs) await waitOrAbort(spec.delayMs, config);
    if (spec.advanceMs) clock?.advance(spec.advanceMs);
    const response: AxiosResponse = {
      data: { ok: spec.status < 400 },
      status: spec.status,
      statusText: String(spec.status),
      headers: new AxiosHeaders(spec.headers ?? {}),
      config,
    };
    if (spec.status >= 400) {
      const code = spec.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST;
      throw new AxiosError(`Request failed with status code ${spec.status}`, code, config, null, response);
    }
    return response;
  };
  return { adapter, calls };
}

export const basePolicy: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: [0],
  totalBudgetMs: 10_000,
  perAttemptTimeoutMs: 5_000,
};

/** An Axios instance backed by a stub adapter with retry attached. */
export function stubClient(
  steps: Step[],
  policy: Partial<RetryPolicy> = {},
  options: { deps?: RetryDeps; clock?: FakeClock; timeout?: number } = {},
): { client: AxiosInstance; calls: InternalAxiosRequestConfig[] } {
  const { adapter, calls } = stubAdapter(steps, options.clock);
  const client = axios.create({ baseURL: 'https://rest.example.org', adapter, timeout: options.timeout });
  attachRetry(client, { ...basePolicy, ...policy }, 'ensembl', {
    sleep: async () => {},
    ...(options.clock ? { now: options.clock.now } : {}),
    ...options.deps,
  });
  return { client, calls };
}

/** Awaits a rejection and returns the error. */
export async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

/** Runs a platform tool through the real CallTool handler (tool-call context, structured errors). */
export function callTool(
  handlers: Record<string, ToolHandler>,
  name: string,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>,
): Promise<CallToolResult> {
  const handle = createCallToolHandler(new Map(Object.entries(handlers)));
  return handle(
    { method: 'tools/call', params: { name, arguments: args, _meta: meta } },
    { signal: new AbortController().signal },
  );
}

/** The text of a tool result's first content item. */
export function toolText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type !== 'text') throw new Error('expected text content');
  return item.text;
}
