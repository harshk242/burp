import { CanceledError } from 'axios';
import { describe, expect, it } from 'vitest';
import {
  REASON_TO_KIND,
  classifyError,
  formatUpstreamMessage,
  getHeader,
  getRetryAfterMs,
  isRetryableReason,
  isRetryableTransportOr5xx,
  parseRateLimitReset,
  parseRetryAfter,
} from '../http-retry-classify.js';
import { axiosFailure } from './retry-test-utils.js';

describe('classifyError', () => {
  it.each([
    ['ECONNABORTED', 'attempt_timeout'],
    ['ETIMEDOUT', 'attempt_timeout'],
    ['ECONNRESET', 'network'],
    ['ENOTFOUND', 'network'],
    ['EAI_AGAIN', 'network'],
    ['ERR_NETWORK', 'network'],
    ['EPIPE', 'network'],
    ['ERR_INVALID_URL', 'bad_request'],
    ['ERR_BAD_REQUEST', 'bad_request'],
    ['ERR_BAD_OPTION', 'bad_request'],
    ['ERR_BAD_OPTION_VALUE', 'bad_request'],
    ['ERR_NOT_SUPPORT', 'bad_request'],
    ['ERR_SOMETHING_NEW', 'unknown'],
    [undefined, 'unknown'],
  ])('maps Axios code %s to %s', (code, reason) => {
    expect(classifyError(axiosFailure({ code }))).toBe(reason);
  });

  it.each([
    [408, 'attempt_timeout'],
    [429, 'rate_limited'],
    [404, 'not_found'],
    [400, 'bad_request'],
    [422, 'bad_request'],
    [500, 'http_5xx'],
    [503, 'http_5xx'],
  ])('maps HTTP %i to %s', (status, reason) => {
    expect(classifyError(axiosFailure({ status }))).toBe(reason);
  });

  it('treats Network Error / socket hang up messages without a response as network', () => {
    expect(classifyError(axiosFailure({ message: 'Network Error' }))).toBe('network');
    expect(classifyError(axiosFailure({ message: 'socket hang up' }))).toBe('network');
  });

  it('classifies Axios cancellation as cancelled', () => {
    expect(classifyError(new CanceledError())).toBe('cancelled');
    expect(classifyError(axiosFailure({ code: 'ERR_CANCELED' }))).toBe('cancelled');
  });

  it('classifies non-Axios errors (e.g. schema assertions) as unknown', () => {
    expect(classifyError(new Error('schema changed'))).toBe('unknown');
    expect(classifyError('boom')).toBe('unknown');
  });

  it('only retries network, attempt timeouts and 5xx by default', () => {
    expect(['network', 'attempt_timeout', 'http_5xx'].every((r) => isRetryableReason(r as never))).toBe(true);
    for (const reason of ['budget_timeout', 'rate_limited', 'not_found', 'bad_request', 'cancelled', 'unknown']) {
      expect(isRetryableReason(reason as never)).toBe(false);
    }
  });
});

describe('isRetryableTransportOr5xx', () => {
  it('drops HTTP 408 but keeps transport timeouts, network and 5xx', () => {
    const http408 = axiosFailure({ status: 408 });
    const transport = axiosFailure({ code: 'ECONNABORTED' });
    expect(isRetryableTransportOr5xx(classifyError(http408), http408)).toBe(false);
    expect(isRetryableTransportOr5xx(classifyError(transport), transport)).toBe(true);
    expect(isRetryableTransportOr5xx('network', axiosFailure({ code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryableTransportOr5xx('http_5xx', axiosFailure({ status: 503 }))).toBe(true);
    expect(isRetryableTransportOr5xx('bad_request', axiosFailure({ status: 400 }))).toBe(false);
  });
});

describe('REASON_TO_KIND', () => {
  it('is the fixed tool-contract table', () => {
    const table = Object.fromEntries(
      Object.entries(REASON_TO_KIND).map(([reason, info]) => [reason, [info.kind, info.retryableLater]]),
    );
    expect(table).toEqual({
      network: ['upstream_unavailable', true],
      http_5xx: ['upstream_unavailable', true],
      attempt_timeout: ['timeout', true],
      budget_timeout: ['timeout', true],
      rate_limited: ['rate_limited', true],
      not_found: ['not_found', false],
      bad_request: ['bad_request', false],
      cancelled: ['cancelled', false],
    });
    expect(REASON_TO_KIND.cancelled.hint).toBeNull();
    expect(Object.isFrozen(REASON_TO_KIND)).toBe(true);
  });

  it('builds the agent-facing message with the hint', () => {
    expect(
      formatUpstreamMessage({ reason: 'http_5xx', platform: 'ensembl', status: 500, attempts: 3, elapsedMs: 4_210 }),
    ).toBe(
      'Ensembl returned HTTP 500 on 3 attempts over 4.2s. The service looks temporarily unavailable: try again later or use another source.',
    );
  });
});

describe('Retry-After parsing', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);

  it('parses delay-seconds and HTTP-date values', () => {
    expect(parseRetryAfter('2', now)).toBe(2_000);
    expect(parseRetryAfter(' 1.5 ', now)).toBe(1_500);
    expect(parseRetryAfter(new Date(now + 3_000).toUTCString(), now)).toBe(3_000);
    expect(parseRetryAfter(new Date(now - 3_000).toUTCString(), now)).toBe(0);
    expect(parseRetryAfter('Thursday, 01-Jan-26 00:00:03 GMT', now)).toBe(3_000);
    expect(parseRetryAfter('Thu Jan  1 00:00:03 2026', now)).toBe(3_000);
  });

  it('rejects negative numbers, non-HTTP dates and delays that overflow', () => {
    expect(parseRetryAfter('-1', now)).toBeUndefined();
    expect(parseRetryAfter('2026-01-01T00:00:03Z', now)).toBeUndefined();
    expect(parseRetryAfter('9'.repeat(400), now)).toBeUndefined();
    expect(parseRateLimitReset('-5', 'relative-seconds', now)).toBeUndefined();
    expect(parseRateLimitReset('9'.repeat(400), 'relative-seconds', now)).toBeUndefined();
  });

  it('ignores missing or invalid values', () => {
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });

  it('parses x-ratelimit-reset as seconds or epoch seconds', () => {
    expect(parseRateLimitReset('7', 'relative-seconds', now)).toBe(7_000);
    expect(parseRateLimitReset(String(now / 1_000 + 4), 'epoch-seconds', now)).toBe(4_000);
    expect(parseRateLimitReset('later', 'relative-seconds', now)).toBeUndefined();
  });

  it('reads Retry-After first, then x-ratelimit-reset, from a 429', () => {
    const both = axiosFailure({ status: 429, headers: { 'Retry-After': '2', 'x-ratelimit-reset': '9' } });
    const resetOnly = axiosFailure({ status: 429, headers: { 'x-ratelimit-reset': '9' } });
    expect(getRetryAfterMs(both, now, { name: 'x-ratelimit-reset', semantics: 'relative-seconds' })).toBe(2_000);
    expect(getRetryAfterMs(resetOnly, now, { name: 'x-ratelimit-reset', semantics: 'relative-seconds' })).toBe(9_000);
    for (const bad of ['-1', 'soon', '9'.repeat(400)]) {
      const fallback = axiosFailure({ status: 429, headers: { 'Retry-After': bad, 'x-ratelimit-reset': '9' } });
      expect(getRetryAfterMs(fallback, now, { name: 'x-ratelimit-reset', semantics: 'relative-seconds' })).toBe(9_000);
    }
    expect(getRetryAfterMs(axiosFailure({ status: 429 }), now)).toBeUndefined();
    expect(getRetryAfterMs(new Error('x'), now)).toBeUndefined();
  });

  it('reads headers case-insensitively from plain objects', () => {
    expect(getHeader({ 'RETRY-AFTER': '3' }, 'retry-after')).toBe('3');
    expect(getHeader(undefined, 'retry-after')).toBeUndefined();
  });
});

describe('explicit reset header semantics', () => {
  it('decodes epoch milliseconds without an enormous delay', () => {
    const now = 1_800_000_000_000;
    expect(parseRateLimitReset(String(now + 4000), 'epoch-milliseconds', now)).toBe(4000);
    expect(parseRateLimitReset('1000000001', 'relative-seconds', now)).toBe(1000000001000);
    expect(parseRateLimitReset('7', 'epoch-seconds', now)).toBe(0);
  });
  it('ignores reset headers without platform configuration and honors a configured header name', () => {
    const now = 1_800_000_000_000;
    const error = axiosFailure({ status: 429, headers: { 'x-ratelimit-reset': '9', 'custom-reset': String(now + 1000) } });
    expect(getRetryAfterMs(error, now)).toBeUndefined();
    expect(getRetryAfterMs(error, now, { name: 'custom-reset', semantics: 'epoch-milliseconds' })).toBe(1000);
  });
});
