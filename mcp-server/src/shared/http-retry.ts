import axios, { AxiosHeaders, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
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
  maxAttempts: number;
  backoffMs: readonly number[] | ((attempt: number) => number);
  jitter?: number;
  totalBudgetMs: number;
  perAttemptTimeoutMs: number;
  retryOn?: (reason: RetryReason, error: unknown) => boolean;
  on429?: 'wait' | 'retry' | 'fail';
  maxRetryAfterMs?: number;
  defaultRetryAfterMs?: number;
  retryMethods?: readonly string[];
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
  signal: AbortSignal;
  timeoutMs: number;
}

export interface WithRetryOptions<T> extends RetryDeps {
  platform: string;
  method?: string;
  path?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  statusOf?: (result: T) => number | null;
}

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

export function computeBackoffMs(policy: RetryPolicy, attempt: number, random: () => number = Math.random): number {
  const { backoffMs } = policy;
  const base =
    typeof backoffMs === 'function'
      ? backoffMs(attempt)
      : (backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0);
  const jitter = policy.jitter ?? 0;
  return Math.max(0, Math.round(base * (1 + jitter * (2 * random() - 1))));
}

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
  const nextDelay = (reason: RetryReason, error: unknown, attempt: number, retryAfterMs: number | undefined) => {
    if (attempt >= policy.maxAttempts || !methodRetryable) return null;
    if (reason === 'rate_limited') {
      const on429 = policy.on429 ?? 'wait';
      if (on429 === 'fail') return null;
      if (on429 === 'wait') {
        if (retryAfterMs === undefined) return null;
        const tooLong = retryAfterMs > (policy.maxRetryAfterMs ?? Infinity) || retryAfterMs >= remaining();
        return tooLong ? null : retryAfterMs;
      }
    } else if (!(policy.retryOn ?? isRetryableReason)(reason, error)) {
      return null;
    }
    return computeBackoffMs(policy, attempt, random);
  };
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
        settled = { ok: true, value: await raceAbort(fn({ attempt, signal: combined, timeoutMs }), combined) };
      } catch (error) {
        settled = { ok: false, error };
      }
      if (settled.ok) {
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
      if (delay === null) {
        const reported = reason === 'rate_limited' ? (retryAfterMs ?? policy.defaultRetryAfterMs) : retryAfterMs;
        fail(reason, lastError, reported ?? null);
      }

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
const CALLER_SIGNAL = Symbol('httpRetryCallerSignal');

type RetryRequestConfig = InternalAxiosRequestConfig & { [CALLER_SIGNAL]?: AbortSignal };

export function requestPath(config: InternalAxiosRequestConfig): string {
  try {
    return new URL(axios.getUri(config), 'http://placeholder.invalid').pathname;
  } catch {
    return (config.url ?? '').split('?')[0];
  }
}

function transformErrorResponse(config: InternalAxiosRequestConfig, error: unknown): void {
  const cause = error instanceof UpstreamError ? error.cause : undefined;
  if (!axios.isAxiosError(cause) || !cause.response) return;
  const { response } = cause;
  const headers = AxiosHeaders.from(response.headers as AxiosHeaders);
  const transforms = config.transformResponse;
  const fns = Array.isArray(transforms) ? transforms : transforms ? [transforms] : [];
  try {
    response.data = fns.reduce((data, fn) => fn.call(config, data, headers, response.status), response.data);
    response.headers = headers;
  } catch {
  }
}

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
  // config.signal is aborted, and replaces any adapter rejection with one.
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
    }).catch((error: unknown) => {
      // Axios only transforms a rejection's own `response`.
      transformErrorResponse(config, error);
      throw error;
    });
  };
  instance.defaults.adapter = Object.assign(retrying, { [RETRY_ADAPTER]: true });
  return instance;
}
