import type { AxiosAdapter } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { UpstreamError } from '../../../shared/exceptions.js';
import { TokenBucketRateLimiter } from '../../../shared/rate-limiter.js';
import { runWithToolCallContext } from '../../../shared/tool-call-context.js';
import { rejection, stubAdapter, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { PUBMED_POLICY, PubMedClient } from '../client.js';
import type { PubMedClientOptions } from '../types.js';

const ESEARCH_XML =
  '<?xml version="1.0"?><eSearchResult><Count>1</Count><RetMax>1</RetMax><RetStart>0</RetStart>' +
  '<IdList><Id>28485846</Id></IdList><QueryTranslation>CRISPR</QueryTranslation></eSearchResult>';

function stubPubMed(steps: Step[], options: PubMedClientOptions = {}) {
  const { adapter: base, calls } = stubAdapter(steps);
  const adapter: AxiosAdapter = async (config) => ({ ...(await base(config)), data: ESEARCH_XML });
  const rateLimiter = options.rateLimiter ?? new TokenBucketRateLimiter({ requestsPerSecond: 100 });
  const waitForToken = vi.spyOn(rateLimiter, 'waitForToken');
  const sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  const client = new PubMedClient({ apiKey: 'test', adapter, retryDeps: { sleep }, rateLimiter, ...options });
  return { client, calls, waitForToken, sleep };
}

describe('PUBMED_POLICY', () => {
  it('keeps today’s behaviour with the 40s budget: 3 attempts, 2^n × 1s, 429 fails fast (5s default)', () => {
    expect(PUBMED_POLICY).toMatchObject({
      maxAttempts: 3,
      totalBudgetMs: 40_000,
      perAttemptTimeoutMs: 30_000,
      on429: 'fail',
      fallbackReportedRetryAfterMs: 5_000,
    });
    const backoff = PUBMED_POLICY.backoffMs as (attempt: number) => number;
    expect([backoff(1), backoff(2)]).toEqual([1_000, 2_000]);
  });
});

describe('PubMedClient on the shared retry', () => {
  it('recovers from 500, 500, 200 and parses the response once', async () => {
    const { client, calls, sleep } = stubPubMed([500, 500, 200]);
    await expect(client.search('CRISPR')).resolves.toEqual({
      count: 1,
      pmids: ['28485846'],
      queryTranslation: 'CRISPR',
    });
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
  });

  it('takes an NCBI token before every attempt, retries included', async () => {
    const recovered = stubPubMed(['network', 503, 200]);
    await recovered.client.search('CRISPR');
    expect(recovered.calls).toHaveLength(3);
    expect(recovered.waitForToken).toHaveBeenCalledTimes(recovered.calls.length);

    const failed = stubPubMed([503]);
    await rejection(failed.client.search('CRISPR'));
    expect(failed.calls).toHaveLength(3);
    expect(failed.waitForToken).toHaveBeenCalledTimes(failed.calls.length);
  });

  it('does not retry a 4xx and surfaces it as a structured UpstreamError', async () => {
    const { client, calls } = stubPubMed([400]);
    const error = await rejection(client.search('CRISPR'));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ platform: 'pubmed', kind: 'bad_request', status: 400, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('does not retry an HTTP 408 response, like any other 4xx', async () => {
    const { client, calls } = stubPubMed([408, 200]);
    expect(await rejection(client.search('CRISPR'))).toMatchObject({
      platform: 'pubmed',
      kind: 'timeout',
      status: 408,
      attempts: 1,
    });
    expect(calls).toHaveLength(1);
  });

  it('still retries a transport timeout with no HTTP response', async () => {
    const { client, calls, sleep } = stubPubMed(['timeout', 'timeout', 200]);
    await expect(client.search('CRISPR')).resolves.toBeDefined();
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const exhausted = stubPubMed(['timeout']);
    expect(await rejection(exhausted.client.search('CRISPR'))).toMatchObject({ kind: 'timeout', status: null, attempts: 3 });
    expect(exhausted.calls).toHaveLength(3);
  });

  it('keeps the HTTP 408 rule when the constructor overrides retries', async () => {
    const { client, calls } = stubPubMed([408, 200], { maxAttempts: 4, retryDelay: 10 });
    expect(await rejection(client.search('CRISPR'))).toMatchObject({ status: 408, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(PUBMED_POLICY.retryOn).toBeTypeOf('function');
  });

  it('fails fast on 429 with Retry-After, defaulting to 5s', async () => {
    const directed = stubPubMed([{ status: 429, headers: { 'retry-after': '7' } }, 200]);
    expect(await rejection(directed.client.search('CRISPR'))).toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 7_000,
      attempts: 1,
    });
    expect(directed.calls).toHaveLength(1);

    const bare = stubPubMed([429, 200]);
    expect(await rejection(bare.client.search('CRISPR'))).toMatchObject({ kind: 'rate_limited', retryAfterMs: 5_000 });
    expect(bare.calls).toHaveLength(1);
  });

  it('honours constructor maxAttempts/retryDelay overrides', async () => {
    const { client, calls, sleep } = stubPubMed([503], { maxAttempts: 2, retryDelay: 50 });
    expect(await rejection(client.search('CRISPR'))).toMatchObject({ kind: 'upstream_unavailable', attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50]);

    const longer = stubPubMed([503], { maxAttempts: 4, retryDelay: 10 });
    await rejection(longer.client.search('CRISPR'));
    expect(longer.calls).toHaveLength(4);
    expect(longer.sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20, 40]);
  });

  it('an abort during the token wait sends no request and removes the waiter from the queue', async () => {
    const rateLimiter = new TokenBucketRateLimiter({ requestsPerSecond: 1, burstSize: 1 });
    rateLimiter.tryAcquire();
    const { client, calls } = stubPubMed([200], { rateLimiter });
    const controller = new AbortController();

    const request = runWithToolCallContext({ timeoutMs: 5_000, signal: controller.signal }, () =>
      client.search('CRISPR'),
    );
    await vi.waitFor(() => expect(rateLimiter.getPendingCount()).toBe(1));
    controller.abort();

    expect(await rejection(request)).toMatchObject({ kind: 'cancelled', attempts: 0 });
    expect(calls).toHaveLength(0);
    expect(rateLimiter.getPendingCount()).toBe(0);
  });

  it('serves a cached result without another request or token', async () => {
    const { client, calls, waitForToken } = stubPubMed([200]);
    await client.search('CRISPR');
    await client.search('CRISPR');
    expect(calls).toHaveLength(1);
    expect(waitForToken).toHaveBeenCalledTimes(1);
  });
});
