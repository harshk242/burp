// Shared HTTP retry layer used by platform clients and contract tests
// (see plans/shared-http-retry-plan.md, "Deadlines and cancellation" and "Design").
//
// Timeouts nest: tool-call deadline > request budget > per-attempt timeout.
// Every wait (attempt, backoff sleep, beforeAttempt) is interrupted by one
// combined abort signal. Deadline/budget firing → `budget_timeout`; the
// caller's signal or the MCP request's signal firing → `cancelled`.

import axios, { type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { UpstreamError } from './exceptions.js';
import {
  REASON_TO_KIND,
  classifyError,
  formatUpstreamMessage,
  getErrorStatus,
  getRetryAfterMs,
  isRetryableReason,
  type RetryReason,
  type UpstreamReason,
} from './http-retry-classify.js';
import { createTimeoutSignal, getToolCallContext, type RequestRecord } from './tool-call-context.js';

export interface RetryPolicy {
  /** Total attempts, including the first. */
  maxAttempts: number;
  /** Wait before retry n: list indexed by failed attempt (last entry repeats) or a function of it. */
  backoffMs: readonly number[] | ((attempt: number) => number);
  /** Relative jitter, e.g. 0.25 = ±25%. Default 0. */
  jitter?: number;
  /** Cap on one logical request, all attempts and waits included. */
  totalBudgetMs: number;
  /** Cap on one attempt; further cut down to the caller timeout and the remaining budget. */
  perAttemptTimeoutMs: number;
  /** Overrides the default retry decision for non-429 reasons. */
  retryOn?: (reason: RetryReason, error: unknown) => boolean;
  /** 429 handling: honour Retry-After (`wait`), back off as usual (`retry`) or give up (`fail`). Default `wait`. */
  on429?: 'wait' | 'retry' | 'fail';
  /** Largest server-directed wait accepted with `on429: 'wait'`. */
  maxRetryAfterMs?: number;
  /** Methods that may be retried (case-insensitive). Default: all. */
  retryMethods?: readonly string[];
  /** Runs before every attempt (e.g. a rate-limiter token); its wait counts against the budget. */
  beforeAttempt?: (signal: AbortSignal, remainingMs: number) => Promise<void>;
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface RetryDeps {
  sleep?: Sleep;
  now?: () => number;
  random?: () => number;
}

export interface AttemptContext {
  attempt: number;
  /** Combined caller/deadline/budget signal: pass it to the request. */
  signal: AbortSignal;
  /** Per-attempt timeout to apply to the request (always > 0). */
  timeoutMs: number;
}

export interface WithRetryOptions<T> extends RetryDeps {
  platform: string;
  method?: string;
  /** Path only, recorded in `_meta` and errors. */
  path?: string;
  /** The caller's own abort signal. */
  signal?: AbortSignal;
  /** The caller's/instance timeout; 0 or undefined means none. */
  timeoutMs?: number;
  /** HTTP status of a successful result, for the request record. */
  statusOf?: (result: T) => number | null;
}

/** Abortable sleep: rejects with the signal's reason as soon as it fires. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Settles with `promise`, or rejects as soon as `signal` fires. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      promise.catch(() => {});
      return reject(signal.reason);
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Backoff before the retry that follows failed attempt `attempt` (1-based), with jitter. */
export function computeBackoffMs(policy: RetryPolicy, attempt: number, random: () => number = Math.random): number {
  const { backoffMs } = policy;
  const base =
    typeof backoffMs === 'function'
      ? backoffMs(attempt)
      : (backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0);
  const jitter = policy.jitter ?? 0;
  return Math.max(0, Math.round(base * (1 + jitter * (2 * random() - 1))));
}

/**
 * Runs `fn` with the policy's retry loop. Non-Axios errors are rethrown as-is
 * and never retried; every other final failure becomes an `UpstreamError`.
 */
export async function withRetry<T>(
  fn: (attempt: AttemptContext) => Promise<T>,
  policy: RetryPolicy,
  options: WithRetryOptions<T>,
): Promise<T> {
  const { platform, sleep = abortableSleep, now = Date.now, random = Math.random } = options;
  const method = (options.method ?? 'GET').toUpperCase();
  const path = options.path ?? '';
  const context = getToolCallContext();
  const startedAt = now();
  const record: RequestRecord = {
    platform,
    method,
    path,
    attempts: 0,
    ms: 0,
    statuses: [],
    outcome: 'success',
    reason: null,
  };

  const budgetMs = Math.max(0, Math.min(policy.totalBudgetMs, context ? context.remainingMs() : Infinity));
  const deadlineAt = startedAt + budgetMs;
  const remaining = () => Math.max(0, deadlineAt - now());
  const budget = createTimeoutSignal(budgetMs, 'Request budget exceeded');
  const timeSignals = [budget.signal, context?.deadlineSignal].filter((s): s is AbortSignal => !!s);
  const cancelSignals = [options.signal, context?.callerSignal].filter((s): s is AbortSignal => !!s);
  const combined = AbortSignal.any([...cancelSignals, ...timeSignals]);
  const abortReason = (): UpstreamReason | null => {
    if (timeSignals.some((s) => s.aborted)) return 'budget_timeout';
    if (cancelSignals.some((s) => s.aborted)) return 'cancelled';
    return null;
  };
  const methodRetryable =
    !policy.retryMethods || policy.retryMethods.some((m) => m.toUpperCase() === method);

  const finish = (outcome: RequestRecord['outcome'], reason: RetryReason | null) => {
    record.outcome = outcome;
    record.reason = reason;
    record.ms = Math.max(0, now() - startedAt);
    context?.addRecord(record, startedAt, startedAt + record.ms);
  };
  const fail = (reason: UpstreamReason, cause: unknown, retryAfterMs: number | null = null): never => {
    finish(reason === 'cancelled' ? 'cancelled' : 'failed', reason);
    // The final attempt's status; per-attempt history stays in the record.
    const status = record.statuses.at(-1) ?? null;
    const details = { reason, platform, status, attempts: record.attempts, elapsedMs: record.ms };
    throw new UpstreamError(formatUpstreamMessage(details), {
      ...details,
      kind: REASON_TO_KIND[reason].kind,
      retryAfterMs,
      url: path || null,
      cause,
    });
  };
  // Delay before the next attempt, or null to stop with the current failure.
  const nextDelay = (reason: RetryReason, error: unknown, attempt: number, retryAfterMs: number | undefined) => {
    if (attempt >= policy.maxAttempts || !methodRetryable) return null;
    if (reason === 'rate_limited') {
      const on429 = policy.on429 ?? 'wait';
      if (on429 === 'fail') return null;
      if (on429 === 'wait') {
        // No usable server-directed wait, or one that doesn't fit: fail fast.
        if (retryAfterMs === undefined) return null;
        const tooLong = retryAfterMs > (policy.maxRetryAfterMs ?? Infinity) || retryAfterMs >= remaining();
        return tooLong ? null : retryAfterMs;
      }
    } else if (!(policy.retryOn ?? isRetryableReason)(reason, error)) {
      return null;
    }
    return computeBackoffMs(policy, attempt, random);
  };
  // Converts an interrupted wait into the matching failure; rethrows anything else.
  const interrupted = (error: unknown, lastError: unknown): never => {
    const stop = abortReason();
    if (stop) fail(stop, lastError ?? error);
    finish('failed', 'unknown');
    throw error;
  };

  let lastError: unknown;
  try {
    for (let attempt = 1; ; attempt++) {
      const before = abortReason();
      if (before) fail(before, lastError ?? combined.reason);

      if (policy.beforeAttempt) {
        try {
          await raceAbort(policy.beforeAttempt(combined, remaining()), combined);
        } catch (error) {
          interrupted(error, lastError);
        }
        const after = abortReason();
        if (after) fail(after, lastError ?? combined.reason);
      }

      const callerTimeout = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : Infinity;
      const timeoutMs = Math.ceil(Math.min(policy.perAttemptTimeoutMs, callerTimeout, remaining()));
      if (timeoutMs <= 0) fail('budget_timeout', lastError ?? null);

      record.attempts = attempt;
      let settled: { ok: true; value: T } | { ok: false; error: unknown };
      try {
        // Raced against the combined signal: a callback that ignores the
        // signal can't outlive the budget or a cancellation.
        settled = { ok: true, value: await raceAbort(fn({ attempt, signal: combined, timeoutMs }), combined) };
      } catch (error) {
        settled = { ok: false, error };
      }
      if (settled.ok) {
        // A response that lands after the budget or a cancellation is discarded.
        const late = abortReason();
        record.statuses.push(late ? null : (options.statusOf?.(settled.value) ?? null));
        if (late) fail(late, combined.reason);
        finish('success', null);
        return settled.value;
      }
      lastError = settled.error;
      record.statuses.push(getErrorStatus(lastError));
      const reason = abortReason() ?? classifyError(lastError);

      if (reason === 'unknown') {
        finish('failed', 'unknown');
        throw lastError;
      }
      const retryAfterMs = reason === 'rate_limited' ? getRetryAfterMs(lastError, now()) : undefined;
      const delay = reason === 'cancelled' || reason === 'budget_timeout'
        ? null
        : nextDelay(reason, lastError, attempt, retryAfterMs);
      if (delay === null) fail(reason, lastError, retryAfterMs ?? null);

      try {
        await sleep(delay as number, combined);
      } catch (error) {
        interrupted(error, lastError);
      }
    }
  } finally {
    budget.clear();
  }
}

const RETRY_ADAPTER = Symbol('httpRetryAdapter');
/** Where the request interceptor parks the caller's signal, out of Axios's sight. */
const CALLER_SIGNAL = Symbol('httpRetryCallerSignal');

type RetryRequestConfig = InternalAxiosRequestConfig & { [CALLER_SIGNAL]?: AbortSignal };

/** Path of an Axios request without host or query string. */
export function requestPath(config: InternalAxiosRequestConfig): string {
  try {
    return new URL(axios.getUri(config), 'http://placeholder.invalid').pathname;
  } catch {
    return (config.url ?? '').split('?')[0];
  }
}

/**
 * Wraps the instance's adapter so the whole retry loop runs inside it: request
 * interceptors run once per logical request and retries can't nest.
 *
 * Call it right after `axios.create`: its request interceptor must be the
 * first one registered so it runs last, just before dispatch.
 */
export function attachRetry(
  instance: AxiosInstance,
  policy: RetryPolicy,
  platform: string,
  deps: RetryDeps = {},
): AxiosInstance {
  const current = instance.defaults.adapter as unknown;
  if (typeof current === 'function' && RETRY_ADAPTER in current) {
    throw new Error(`attachRetry: retry is already attached to this ${platform} instance`);
  }
  const adapter = axios.getAdapter(instance.defaults.adapter);
  // Axios rejects with a bare CanceledError, before and after the adapter, when
  // config.signal is aborted, and replaces any adapter rejection with one. The
  // loop owns the caller signal instead, so every cancellation (already aborted,
  // aborted while interceptors ran, or mid-retry) surfaces as
  // UpstreamError(cancelled). The interceptor is async (the default), which
  // also keeps Axios on its promise chain.
  instance.interceptors.request.use((config: RetryRequestConfig) => {
    if (config.signal instanceof AbortSignal) {
      config[CALLER_SIGNAL] = config.signal;
      config.signal = undefined;
    }
    return config;
  });
  const retrying = (config: RetryRequestConfig): Promise<AxiosResponse> => {
    const callerSignal =
      config[CALLER_SIGNAL] ?? (config.signal instanceof AbortSignal ? config.signal : undefined);
    config.signal = undefined;
    return withRetry(({ signal, timeoutMs }) => adapter({ ...config, signal, timeout: timeoutMs }), policy, {
      ...deps,
      platform,
      method: config.method,
      path: requestPath(config),
      signal: callerSignal,
      timeoutMs: config.timeout,
      statusOf: (response) => response.status,
    });
  };
  instance.defaults.adapter = Object.assign(retrying, { [RETRY_ADAPTER]: true });
  return instance;
}
