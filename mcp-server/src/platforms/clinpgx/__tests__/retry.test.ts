// ClinPGx on the shared HTTP retry: policy wiring, 404 → empty results, 429
// backoff and constructor overrides. Stub adapter only, no network.

import type { AxiosAdapter } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { UpstreamError } from '../../../shared/exceptions.js';
import { rejection, stubAdapter, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { CLINPGX_POLICY, PharmGKBClient } from '../client.js';
import type { PharmGKBClientOptions } from '../types.js';

const GENE_SEARCH = { data: [{ id: 'PA128', symbol: 'CYP2D6', name: 'cytochrome P450 family 2 subfamily D member 6' }] };

/** A ClinPGx client on a stub transport whose successes carry a gene search body. */
function stubClinPGx(steps: Step[], options: PharmGKBClientOptions = {}) {
  const { adapter: base, calls } = stubAdapter(steps);
  const adapter: AxiosAdapter = async (config) => ({ ...(await base(config)), data: GENE_SEARCH });
  const sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  const client = new PharmGKBClient({ adapter, retryDeps: { sleep }, ...options });
  return { client, calls, sleep };
}

describe('CLINPGX_POLICY', () => {
  it('keeps today’s behaviour with the 40s budget: 3 attempts, 2^n × 1s, 429 retried with backoff', () => {
    expect(CLINPGX_POLICY).toMatchObject({
      maxAttempts: 3,
      totalBudgetMs: 40_000,
      perAttemptTimeoutMs: 30_000,
      on429: 'retry',
    });
    const backoff = CLINPGX_POLICY.backoffMs as (attempt: number) => number;
    expect([backoff(1), backoff(2)]).toEqual([1_000, 2_000]);
  });
});

describe('PharmGKBClient on the shared retry', () => {
  it('recovers from 500, 500, 200 with 2^n × 1s backoff', async () => {
    const { client, calls, sleep } = stubClinPGx([500, 500, 200]);
    const result = await client.searchGenes('CYP2D6');
    expect(result.results.map((g) => g.symbol)).toEqual(['CYP2D6']);
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
  });

  it('turns a 404 into an empty result / null with a single request', async () => {
    const search = stubClinPGx([404, 200]);
    await expect(search.client.searchGenes('NOPE')).resolves.toEqual({ totalCount: 0, results: [], query: 'NOPE' });
    expect(search.calls).toHaveLength(1);

    const lookup = stubClinPGx([404, 200]);
    await expect(lookup.client.getGeneInfo('PA999999')).resolves.toBeNull();
    expect(lookup.calls).toHaveLength(1);
    expect(lookup.sleep).not.toHaveBeenCalled();
  });

  it('retries a 429 with the usual backoff, ignoring Retry-After', async () => {
    const { client, calls, sleep } = stubClinPGx([{ status: 429, headers: { 'retry-after': '30' } }, 200]);
    await expect(client.searchGenes('CYP2D6')).resolves.toMatchObject({ totalCount: 1 });
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000]);

    const exhausted = stubClinPGx([429]);
    expect(await rejection(exhausted.client.searchGenes('CYP2D6'))).toMatchObject({
      platform: 'clinpgx',
      kind: 'rate_limited',
      attempts: 3,
    });
    expect(exhausted.calls).toHaveLength(3);
  });

  it('does not retry another 4xx (HTTP 408 included) and surfaces a structured UpstreamError', async () => {
    const bad = stubClinPGx([400, 200]);
    const error = await rejection(bad.client.searchGenes('CYP2D6'));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ platform: 'clinpgx', kind: 'bad_request', status: 400, attempts: 1 });
    expect(bad.calls).toHaveLength(1);

    const slow = stubClinPGx([408, 200]);
    expect(await rejection(slow.client.searchGenes('CYP2D6'))).toMatchObject({ status: 408, attempts: 1 });
    expect(slow.calls).toHaveLength(1);
  });

  it('honours constructor maxRetries/retryDelay overrides', async () => {
    const { client, calls, sleep } = stubClinPGx([503], { maxRetries: 2, retryDelay: 50 });
    expect(await rejection(client.searchGenes('CYP2D6'))).toMatchObject({ kind: 'upstream_unavailable', attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50]);

    const longer = stubClinPGx(['network'], { maxRetries: 4, retryDelay: 10 });
    await rejection(longer.client.searchGenes('CYP2D6'));
    expect(longer.calls).toHaveLength(4);
    expect(longer.sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20, 40]);
  });

  it('serves a cached result without another request', async () => {
    const { client, calls } = stubClinPGx([200]);
    await client.searchGenes('CYP2D6');
    await client.searchGenes('CYP2D6');
    expect(calls).toHaveLength(1);
  });
});
