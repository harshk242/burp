import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '../exceptions.js';
import { attachRetry, computeBackoffMs, withRetry, type RetryPolicy } from '../http-retry.js';
import { runWithToolCallContext } from '../tool-call-context.js';
import { axiosFailure, basePolicy, fakeClock, rejection, stubClient } from './retry-test-utils.js';

describe('request counts', () => {
  it('makes 1 request when the first succeeds', async () => {
    const { client, calls } = stubClient([200]);
    await expect(client.get('/x')).resolves.toMatchObject({ status: 200 });
    expect(calls).toHaveLength(1);
  });

  it('makes 3 requests for 500, 500, 200', async () => {
    const { client, calls } = stubClient([500, 500, 200]);
    await expect(client.get('/x')).resolves.toMatchObject({ status: 200 });
    expect(calls).toHaveLength(3);
  });

  it('makes 1 request for a 4xx', async () => {
    const { client, calls } = stubClient([400]);
    const error = await rejection(client.get('/x'));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ kind: 'bad_request', reason: 'bad_request', status: 400, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('makes 1 request with maxAttempts: 1', async () => {
    const { client, calls } = stubClient([503], { maxAttempts: 1 });
    expect(await rejection(client.get('/x'))).toMatchObject({ reason: 'http_5xx', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('stops with all attempts used and keeps the last AxiosError as cause', async () => {
    const { client, calls } = stubClient(['network', 'timeout', 502]);
    const error = await rejection(client.get('/lookup/id/X?expand=1'));
    expect(calls).toHaveLength(3);
    expect(error).toMatchObject({
      kind: 'upstream_unavailable',
      reason: 'http_5xx',
      platform: 'ensembl',
      status: 502,
      attempts: 3,
      url: '/lookup/id/X',
      retryAfterMs: null,
    });
    expect(error.cause.response.status).toBe(502);
  });

  it('stops after n requests when the budget runs out', async () => {
    const clock = fakeClock();
    const step = { status: 500, advanceMs: 20_000 };
    const { client, calls } = stubClient(
      [step],
      { maxAttempts: 10, totalBudgetMs: 50_000, perAttemptTimeoutMs: 30_000 },
      { clock },
    );
    const error = await rejection(client.get('/x'));
    expect(calls.map((c) => c.timeout)).toEqual([30_000, 30_000, 10_000]);
    expect(error).toMatchObject({ kind: 'timeout', reason: 'budget_timeout', attempts: 3, status: 500 });
  });

  it('retries POST by default and honours retryMethods', async () => {
    const post = stubClient([500, 200]);
    await expect(post.client.post('/vep/human/region', { variants: [] })).resolves.toMatchObject({ status: 200 });
    expect(post.calls).toHaveLength(2);
    expect(post.calls.every((c) => c.method === 'post')).toBe(true);

    const getOnly = stubClient([500, 200], { retryMethods: ['GET'] });
    expect(await rejection(getOnly.client.post('/x', {}))).toMatchObject({ reason: 'http_5xx', attempts: 1 });
    expect(getOnly.calls).toHaveLength(1);
  });

  it('uses retryOn to override the default decision', async () => {
    const { client, calls } = stubClient([404, 200], { retryOn: (reason) => reason === 'not_found' });
    await expect(client.get('/x')).resolves.toMatchObject({ status: 200 });
    expect(calls).toHaveLength(2);
  });
});

describe('final failure details', () => {
  it("reports the final attempt's status and keeps the history in the record", async () => {
    const { client } = stubClient([500, 'network', 'network']);
    const { error, meta } = await runWithToolCallContext({ timeoutMs: 5_000 }, async (context) => ({
      error: await rejection(client.get('/x')),
      meta: context.buildRetryMeta({ isError: true }),
    }));
    expect(error).toMatchObject({ reason: 'network', status: null, attempts: 3 });
    expect(meta?.requests[0].statuses).toEqual([500, null, null]);
  });

  it.each(['ERR_BAD_REQUEST', 'ERR_BAD_OPTION_VALUE', 'ERR_INVALID_URL', 'ERR_NOT_SUPPORT'])(
    'fails a local %s request error once as bad_request',
    async (code) => {
      const fn = vi.fn().mockRejectedValue(axiosFailure({ code }));
      const error = await rejection(withRetry(fn, basePolicy, { platform: 'p', sleep: async () => {} }));
      expect(error).toMatchObject({ kind: 'bad_request', reason: 'bad_request', attempts: 1 });
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  it('does not send an unsupported-protocol URL three times (real Axios adapter, no network)', async () => {
    const client = attachRetry(axios.create(), basePolicy, 'p', { sleep: async () => {} });
    const error = await rejection(client.get('ftp://example.invalid/x'));
    expect(error).toMatchObject({ kind: 'bad_request', reason: 'bad_request', attempts: 1 });
    expect(error.cause.code).toBe('ERR_BAD_REQUEST');
  });

  it('rethrows an unrecognised Axios failure as-is after one attempt', async () => {
    const failure = axiosFailure({ code: 'ERR_SOMETHING_NEW' });
    const fn = vi.fn().mockRejectedValue(failure);
    await expect(withRetry(fn, basePolicy, { platform: 'p', sleep: async () => {} })).rejects.toBe(failure);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withRetry', () => {
  it('never retries non-Axios errors and rethrows them unchanged', async () => {
    const failure = new Error('schema changed');
    const fn = vi.fn().mockRejectedValue(failure);
    await expect(withRetry(fn, basePolicy, { platform: 'ensembl', sleep: async () => {} })).rejects.toBe(failure);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries Axios failures from any caller and passes attempt info', async () => {
    const fn = vi.fn().mockRejectedValueOnce(axiosFailure({ status: 503 })).mockResolvedValueOnce('ok');
    await expect(withRetry(fn, basePolicy, { platform: 'p', sleep: async () => {} })).resolves.toBe('ok');
    expect(fn.mock.calls.map(([a]) => a.attempt)).toEqual([1, 2]);
    expect(fn.mock.calls[0][0].timeoutMs).toBe(5_000);
    expect(fn.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('backoff and jitter', () => {
  const policy: RetryPolicy = { ...basePolicy, backoffMs: [1_000, 3_000], jitter: 0.25 };

  it('uses the list per failed attempt and repeats the last entry', () => {
    const flat = { ...policy, jitter: 0 };
    expect([1, 2, 3, 4].map((n) => computeBackoffMs(flat, n))).toEqual([1_000, 3_000, 3_000, 3_000]);
    expect(computeBackoffMs({ ...basePolicy, backoffMs: (n) => 2 ** (n - 1) * 100 }, 3)).toBe(400);
  });

  it('keeps jitter within ±jitter of the base', () => {
    expect(computeBackoffMs(policy, 1, () => 0)).toBe(750);
    expect(computeBackoffMs(policy, 1, () => 0.5)).toBe(1_000);
    expect(computeBackoffMs(policy, 1, () => 0.999999)).toBe(1_250);
    for (let i = 0; i < 200; i++) {
      const delay = computeBackoffMs(policy, 2);
      expect(delay).toBeGreaterThanOrEqual(2_250);
      expect(delay).toBeLessThanOrEqual(3_750);
    }
  });

  it('sleeps the jittered backoff between attempts', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { client } = stubClient([500, 500, 200], policy, { deps: { sleep, random: () => 0 } });
    await client.get('/x');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([750, 2_250]);
  });
});

describe('429 handling', () => {
  const rateLimited = { status: 429, headers: { 'retry-after': '2' } };

  it('wait: honours Retry-After when it fits', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = stubClient([rateLimited, 200], { on429: 'wait' }, { deps: { sleep } });
    await expect(client.get('/x')).resolves.toMatchObject({ status: 200 });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2_000, expect.any(AbortSignal));
  });

  it('wait: fails fast as rate_limited when the wait exceeds the cap or the budget', async () => {
    for (const policy of [{ maxRetryAfterMs: 1_000 }, { totalBudgetMs: 1_500 }]) {
      const { client, calls } = stubClient([rateLimited, 200], { on429: 'wait', ...policy });
      const error = await rejection(client.get('/x'));
      expect(error).toMatchObject({ kind: 'rate_limited', reason: 'rate_limited', retryAfterMs: 2_000, attempts: 1 });
      expect(calls).toHaveLength(1);
    }
  });

  it.each([
    ['no header', {}],
    ['an invalid Retry-After', { 'retry-after': 'soon' }],
    ['a negative Retry-After', { 'retry-after': '-1' }],
  ])('wait: fails fast as rate_limited with %s', async (_, headers) => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = stubClient([{ status: 429, headers }, 200], { backoffMs: [123] }, { deps: { sleep } });
    const error = await rejection(client.get('/x'));
    expect(error).toMatchObject({ kind: 'rate_limited', reason: 'rate_limited', retryAfterMs: null, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('wait: falls back to x-ratelimit-reset when Retry-After is unusable', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const headers = { 'retry-after': '-1', 'x-ratelimit-reset': '3' };
    const { client } = stubClient([{ status: 429, headers }, 200], {}, { deps: { sleep } });
    await expect(client.get('/x')).resolves.toMatchObject({ status: 200 });
    expect(sleep).toHaveBeenCalledWith(3_000, expect.any(AbortSignal));
  });

  it('retry: backs off as usual and ignores Retry-After', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = stubClient([rateLimited, rateLimited, 200], { on429: 'retry', backoffMs: [10] }, {
      deps: { sleep },
    });
    await expect(client.get('/x')).resolves.toMatchObject({ status: 200 });
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 10]);
  });

  it('fail: gives up at once with the server-directed wait', async () => {
    const { client, calls } = stubClient([rateLimited, 200], { on429: 'fail' });
    expect(await rejection(client.get('/x'))).toMatchObject({ kind: 'rate_limited', retryAfterMs: 2_000 });
    expect(calls).toHaveLength(1);
  });

  it('reports defaultRetryAfterMs only when the 429 carries no usable wait', async () => {
    const policy = { on429: 'fail' as const, defaultRetryAfterMs: 5_000 };
    const bare = stubClient([429], policy);
    expect(await rejection(bare.client.get('/x'))).toMatchObject({ kind: 'rate_limited', retryAfterMs: 5_000 });
    const directed = stubClient([rateLimited], policy);
    expect(await rejection(directed.client.get('/x'))).toMatchObject({ retryAfterMs: 2_000 });
    const notRateLimited = stubClient([400], policy);
    expect(await rejection(notRateLimited.client.get('/x'))).toMatchObject({ retryAfterMs: null });
  });
});

describe('beforeAttempt', () => {
  it('runs before every attempt with the remaining budget', async () => {
    const clock = fakeClock();
    const beforeAttempt = vi.fn(async () => clock.advance(1_000));
    const { client, calls } = stubClient([500, 500, 200], { beforeAttempt }, { clock });
    await client.get('/x');
    expect(beforeAttempt).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(3);
    expect(beforeAttempt.mock.calls.map((c) => (c as unknown[])[1])).toEqual([10_000, 9_000, 8_000]);
  });

  it('counts its wait against the budget', async () => {
    const clock = fakeClock();
    const beforeAttempt = vi.fn(async () => clock.advance(4_000));
    const { client, calls } = stubClient([500], { beforeAttempt, maxAttempts: 5 }, { clock });
    const error = await rejection(client.get('/x'));
    // 4s wait + attempt (5s cap), 4s wait + attempt clamped to 2s, then no time left.
    expect(calls.map((c) => c.timeout)).toEqual([5_000, 2_000]);
    expect(error).toMatchObject({ reason: 'budget_timeout', attempts: 2 });
  });

  it('rethrows its own non-abort errors without sending', async () => {
    const failure = new Error('limiter broken');
    const { client, calls } = stubClient([200], { beforeAttempt: async () => { throw failure; } });
    expect(await rejection(client.get('/x'))).toBe(failure);
    expect(calls).toHaveLength(0);
  });
});
