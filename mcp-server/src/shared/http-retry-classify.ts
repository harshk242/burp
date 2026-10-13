// Error classification, public error kinds and Retry-After parsing for the
// shared HTTP retry layer (see plans/shared-http-retry-plan.md).

import axios from 'axios';

/** Internal failure reason. Drives the retry decision and goes in logs and `_meta`. */
export type RetryReason =
  | 'network'
  | 'attempt_timeout'
  | 'budget_timeout'
  | 'http_5xx'
  | 'rate_limited'
  | 'not_found'
  | 'bad_request'
  | 'cancelled'
  | 'unknown';

/** Reasons that become an `UpstreamError`. `unknown` (non-Axios) errors are rethrown as-is. */
export type UpstreamReason = Exclude<RetryReason, 'unknown'>;

/** Public error kind the agent sees as `error`. */
export type UpstreamErrorKind =
  | 'upstream_unavailable'
  | 'timeout'
  | 'rate_limited'
  | 'not_found'
  | 'bad_request'
  | 'cancelled';

export interface UpstreamKindInfo {
  kind: UpstreamErrorKind;
  retryableLater: boolean;
  hint: string | null;
}

/**
 * Fixed reason → public kind mapping. This table is part of the tool contract:
 * changing a kind is a breaking change for prompts and evals.
 */
export const REASON_TO_KIND: Readonly<Record<UpstreamReason, Readonly<UpstreamKindInfo>>> = Object.freeze({
  network: {
    kind: 'upstream_unavailable',
    retryableLater: true,
    hint: 'The service looks temporarily unavailable: try again later or use another source.',
  },
  http_5xx: {
    kind: 'upstream_unavailable',
    retryableLater: true,
    hint: 'The service looks temporarily unavailable: try again later or use another source.',
  },
  attempt_timeout: {
    kind: 'timeout',
    retryableLater: true,
    hint: 'The request took too long: narrow the query (fewer IDs, a smaller region or a lower limit).',
  },
  budget_timeout: {
    kind: 'timeout',
    retryableLater: true,
    hint: 'The request took too long: narrow the query (fewer IDs, a smaller region or a lower limit).',
  },
  rate_limited: {
    kind: 'rate_limited',
    retryableLater: true,
    hint: 'The service is rate limiting requests: wait retry_after_ms before trying again.',
  },
  not_found: {
    kind: 'not_found',
    retryableLater: false,
    hint: 'The resource was not found: check the identifier.',
  },
  bad_request: {
    kind: 'bad_request',
    retryableLater: false,
    hint: 'The service rejected the request: fix the arguments.',
  },
  cancelled: { kind: 'cancelled', retryableLater: false, hint: null },
});

const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);
// Transport failures known to be transient: the request may not have reached the upstream.
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'ERR_NETWORK',
]);
const NETWORK_MESSAGES = new Set(['Network Error', 'socket hang up']);
// Axios codes for a request rejected locally (bad URL, protocol or option):
// nothing reached the upstream and retrying cannot help.
const CONFIG_CODES = new Set([
  'ERR_BAD_REQUEST',
  'ERR_BAD_OPTION',
  'ERR_BAD_OPTION_VALUE',
  'ERR_INVALID_URL',
  'ERR_NOT_SUPPORT',
  'ERR_DEPRECATED',
  'ERR_FR_TOO_MANY_REDIRECTS',
]);

/**
 * Classifies one attempt's failure. Non-Axios errors, and Axios failures that
 * are neither a known transport error nor a local request error, are `unknown`
 * (never retried, rethrown as-is).
 */
export function classifyError(error: unknown): RetryReason {
  if (axios.isCancel(error)) return 'cancelled';
  if (!axios.isAxiosError(error)) return 'unknown';

  const status = error.response?.status;
  if (status !== undefined) {
    if (status === 408) return 'attempt_timeout';
    if (status === 429) return 'rate_limited';
    if (status === 404) return 'not_found';
    if (status >= 500 && status <= 599) return 'http_5xx';
    if (status >= 400) return 'bad_request';
    return 'unknown';
  }

  const code = error.code ?? '';
  if (code === 'ERR_CANCELED') return 'cancelled';
  if (TIMEOUT_CODES.has(code)) return 'attempt_timeout';
  if (NETWORK_CODES.has(code) || NETWORK_MESSAGES.has(error.message)) return 'network';
  if (CONFIG_CODES.has(code)) return 'bad_request';
  return 'unknown';
}

/** Default retry decision for a reason (429 is decided separately by `on429`). */
export function isRetryableReason(reason: RetryReason): boolean {
  return reason === 'network' || reason === 'attempt_timeout' || reason === 'http_5xx';
}

/**
 * `retryOn` for upstreams that fail every non-429 4xx at once (NCBI): the
 * default rule minus HTTP 408, while transport timeouts with no response are
 * still retried.
 */
export function isRetryableTransportOr5xx(reason: RetryReason, error: unknown): boolean {
  if (reason === 'attempt_timeout' && getErrorStatus(error) !== null) return false;
  return isRetryableReason(reason);
}

/** HTTP status of an Axios error, or null when there was no response. */
export function getErrorStatus(error: unknown): number | null {
  return axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
}

/** Reads a header from plain or AxiosHeaders objects, case-insensitively. */
export function getHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const lower = name.toLowerCase();
  const maybe = headers as Record<string, unknown> & { get?: (n: string) => unknown };
  let value: unknown = typeof maybe.get === 'function' ? maybe.get(lower) : undefined;
  if (value === undefined || value === null) {
    const key = Object.keys(maybe).find((k) => k.toLowerCase() === lower);
    value = key === undefined ? undefined : maybe[key];
  }
  if (Array.isArray(value)) value = value[0];
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value : undefined;
}

const NON_NEGATIVE_NUMBER = /^\s*\d+(?:\.\d+)?\s*$/;
// RFC 9110 HTTP-date: IMF-fixdate, obsolete RFC 850 and asctime formats.
const HTTP_DATE = new RegExp(
  [
    /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
    /^[A-Z][a-z]+, \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT$/,
    /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/,
  ].map((r) => r.source).join('|'),
);

/** A finite, non-negative delay in ms, or undefined. */
function finiteDelay(ms: number): number | undefined {
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

/** Parses a Retry-After value (delay-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'string') return undefined;
  if (NON_NEGATIVE_NUMBER.test(value)) return finiteDelay(Number(value) * 1_000);
  const trimmed = value.trim();
  if (!HTTP_DATE.test(trimmed)) return undefined;
  // asctime carries no zone; HTTP-dates are always GMT.
  const date = Date.parse(trimmed.endsWith('GMT') ? trimmed : `${trimmed} GMT`);
  return Number.isNaN(date) ? undefined : finiteDelay(date - now);
}

/**
 * Parses `x-ratelimit-reset`. Ensembl sends seconds until the window resets;
 * values that look like Unix epoch seconds are treated as an absolute time.
 */
export function parseRateLimitReset(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'string' || !NON_NEGATIVE_NUMBER.test(value)) return undefined;
  const seconds = Number(value);
  if (seconds > 1_000_000_000) return finiteDelay(seconds * 1_000 - now);
  return finiteDelay(seconds * 1_000);
}

/** Server-directed wait for a 429, from `Retry-After` then `x-ratelimit-reset`. */
export function getRetryAfterMs(error: unknown, now = Date.now()): number | undefined {
  if (!axios.isAxiosError(error) || !error.response) return undefined;
  const headers = error.response.headers;
  return (
    parseRetryAfter(getHeader(headers, 'retry-after'), now) ??
    parseRateLimitReset(getHeader(headers, 'x-ratelimit-reset'), now)
  );
}

/** Builds the agent-facing message for a final upstream failure. */
export function formatUpstreamMessage(details: {
  reason: UpstreamReason;
  platform: string;
  status: number | null;
  attempts: number;
  elapsedMs: number;
}): string {
  const name = details.platform.charAt(0).toUpperCase() + details.platform.slice(1);
  const seconds = (details.elapsedMs / 1_000).toFixed(1);
  const tries = `${details.attempts} attempt${details.attempts === 1 ? '' : 's'}`;
  let what: string;
  switch (details.reason) {
    case 'cancelled':
      return `${name} request was cancelled after ${tries} over ${seconds}s.`;
    case 'budget_timeout':
      what =
        details.attempts === 0
          ? `${name} request was not sent: the time budget was already used up`
          : `${name} did not answer within the time budget (${tries} over ${seconds}s)`;
      break;
    case 'attempt_timeout':
      what = `${name} timed out on ${tries} over ${seconds}s`;
      break;
    case 'network':
      what = `${name} could not be reached on ${tries} over ${seconds}s`;
      break;
    default:
      what = details.status === null
        ? `${name} request failed on ${tries} over ${seconds}s`
        : `${name} returned HTTP ${details.status} on ${tries} over ${seconds}s`;
  }
  return `${what}. ${REASON_TO_KIND[details.reason].hint}`;
}
