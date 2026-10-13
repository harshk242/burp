// ClinVar on the shared HTTP retry: NCBI policy with a token per attempt,
// abortable token waits, constructor overrides, and Clinical Tables at one
// attempt with no rate limiter. Stub adapter only, no network.

import type { AxiosAdapter } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { UpstreamError } from '../../../shared/exceptions.js';
import { TokenBucketRateLimiter } from '../../../shared/rate-limiter.js';
import { runWithToolCallContext } from '../../../shared/tool-call-context.js';
import { rejection, stubAdapter, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { CLINICAL_TABLES_POLICY, CLINVAR_NCBI_POLICY, ClinVarClient } from '../client.js';
import type { ClinVarClientOptions } from '../types.js';

const ESEARCH_XML =
  '<?xml version="1.0"?><eSearchResult><Count>1</Count><IdList><Id>12375</Id></IdList></eSearchResult>';
const CLINICAL_TABLES_BODY = [1, ['12375'], null, [['NM_000546.6(TP53):c.215C>G', 'TP53', 'Benign', '17', '7676154']]];

/** A ClinVar client on a stub transport; successes carry the body for whichever API was called. */
function stubClinVar(steps: Step[], options: ClinVarClientOptions = {}) {
  const { adapter: base, calls } = stubAdapter(steps);
  const adapter: AxiosAdapter = async (config) => {
    const response = await base(config);
    const isNcbi = config.baseURL?.includes('eutils') ?? false;
    return { ...response, data: isNcbi ? ESEARCH_XML : CLINICAL_TABLES_BODY };
  };
  const rateLimiter = options.rateLimiter ?? new TokenBucketRateLimiter({ requestsPerSecond: 100 });
  const waitForToken = vi.spyOn(rateLimiter, 'waitForToken');
  const sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  const client = new ClinVarClient({ apiKey: 'test', adapter, retryDeps: { sleep }, rateLimiter, ...options });
  return { client, calls, waitForToken, sleep };
}

describe('ClinVar retry policies', () => {
  it('NCBI keeps today’s behaviour with the 40s budget: 3 attempts, 2^n × 1s, 429 fails fast (5s default)', () => {
    expect(CLINVAR_NCBI_POLICY).toMatchObject({
      maxAttempts: 3,
      totalBudgetMs: 40_000,
      perAttemptTimeoutMs: 30_000,
      on429: 'fail',
      defaultRetryAfterMs: 5_000,
    });
    const backoff = CLINVAR_NCBI_POLICY.backoffMs as (attempt: number) => number;
    expect([backoff(1), backoff(2)]).toEqual([1_000, 2_000]);
  });

  it('Clinical Tables stays at one attempt with no rate limiter', () => {
    expect(CLINICAL_TABLES_POLICY).toMatchObject({ maxAttempts: 1, totalBudgetMs: 40_000 });
    expect(CLINICAL_TABLES_POLICY.beforeAttempt).toBeUndefined();
  });
});

describe('ClinVar NCBI instance on the shared retry', () => {
  it('recovers from 500, 500, 200 with 2^n × retryDelay backoff', async () => {
    const { client, calls, sleep } = stubClinVar([500, 500, 200]);
    await expect(client.search('TP53[gene]')).resolves.toEqual({ count: 1, ids: ['12375'] });
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
  });

  it('takes an NCBI token before every attempt, retries included', async () => {
    const recovered = stubClinVar(['network', 503, 200]);
    await recovered.client.search('TP53[gene]');
    expect(recovered.calls).toHaveLength(3);
    expect(recovered.waitForToken).toHaveBeenCalledTimes(recovered.calls.length);

    const failed = stubClinVar([503]);
    await rejection(failed.client.search('TP53[gene]'));
    expect(failed.calls).toHaveLength(3);
    expect(failed.waitForToken).toHaveBeenCalledTimes(failed.calls.length);
  });

  it('does not retry a 4xx and surfaces it as a structured UpstreamError', async () => {
    const { client, calls } = stubClinVar([400]);
    const error = await rejection(client.search('TP53[gene]'));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ platform: 'clinvar', kind: 'bad_request', status: 400, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('fails fast on 429 with Retry-After, defaulting to 5s', async () => {
    const directed = stubClinVar([{ status: 429, headers: { 'retry-after': '3' } }, 200]);
    expect(await rejection(directed.client.search('TP53[gene]'))).toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 3_000,
      attempts: 1,
    });
    expect(directed.calls).toHaveLength(1);

    const bare = stubClinVar([429, 200]);
    expect(await rejection(bare.client.search('TP53[gene]'))).toMatchObject({ kind: 'rate_limited', retryAfterMs: 5_000 });
    expect(bare.calls).toHaveLength(1);
  });

  it('honours constructor maxRetries/retryDelay overrides', async () => {
    const { client, calls, sleep } = stubClinVar([503], { maxRetries: 2, retryDelay: 50 });
    expect(await rejection(client.search('TP53[gene]'))).toMatchObject({ kind: 'upstream_unavailable', attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50]);

    const longer = stubClinVar([503], { maxRetries: 4, retryDelay: 10 });
    await rejection(longer.client.search('TP53[gene]'));
    expect(longer.calls).toHaveLength(4);
    expect(longer.sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20, 40]);
  });

  it('an abort during the token wait sends no request and removes the waiter from the queue', async () => {
    const rateLimiter = new TokenBucketRateLimiter({ requestsPerSecond: 1, burstSize: 1 });
    rateLimiter.tryAcquire(); // empty bucket: the next token is ~1s away
    const { client, calls } = stubClinVar([200], { rateLimiter });
    const controller = new AbortController();

    const request = runWithToolCallContext({ timeoutMs: 5_000, signal: controller.signal }, () =>
      client.search('TP53[gene]'),
    );
    await vi.waitFor(() => expect(rateLimiter.getPendingCount()).toBe(1));
    controller.abort();

    expect(await rejection(request)).toMatchObject({ kind: 'cancelled', attempts: 0 });
    expect(calls).toHaveLength(0);
    expect(rateLimiter.getPendingCount()).toBe(0);
  });
});

describe('ClinVar Clinical Tables instance', () => {
  it('parses a successful lookup without taking an NCBI token', async () => {
    const { client, calls, waitForToken } = stubClinVar([200]);
    const result = await client.quickLookup('rs1042522');
    expect(result).toMatchObject({ totalCount: 1, variants: [{ gene: 'TP53', position: 7676154 }] });
    expect(calls).toHaveLength(1);
    expect(waitForToken).not.toHaveBeenCalled();
  });

  it('still makes exactly 1 attempt on a retryable failure', async () => {
    for (const step of [503, 'network', 'timeout'] as const) {
      const { client, calls, sleep, waitForToken } = stubClinVar([step, 200], { maxRetries: 5 });
      const error = await rejection(client.quickLookup('rs1042522'));
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error).toMatchObject({ platform: 'clinvar', attempts: 1 });
      expect(calls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(waitForToken).not.toHaveBeenCalled();
    }
  });
});
