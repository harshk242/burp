// Open Targets on the shared HTTP retry: policy wiring, 429 backoff, GraphQL
// errors kept outside the retry and constructor overrides. Stub adapter only, no network.

import type { AxiosAdapter } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { UpstreamError } from '../../../shared/exceptions.js';
import { rejection, stubAdapter, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { OPEN_TARGETS_POLICY, OpenTargetsClient, type OpenTargetsClientOptions } from '../client.js';
import { GraphQLError, OpenTargetsAPIError } from '../exceptions.js';

const QUERY = 'query { meta { apiVersion { x } } }';
const DATA = { meta: { apiVersion: { x: '25' } } };
const GRAPHQL_ERRORS = { data: null, errors: [{ message: 'Cannot query field "nope"', path: ['meta'] }] };

/** An Open Targets client on a stub transport whose 200s carry `body` (default: data). */
function stubOpenTargets(steps: Step[], options: OpenTargetsClientOptions = {}, body: unknown = { data: DATA }) {
  const { adapter: base, calls } = stubAdapter(steps);
  const adapter: AxiosAdapter = async (config) => ({ ...(await base(config)), data: body });
  const sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  const client = new OpenTargetsClient({ baseUrl: 'https://ot.example.org/graphql', adapter, retryDeps: { sleep }, ...options });
  return { client, calls, sleep };
}

describe('OPEN_TARGETS_POLICY', () => {
  it('keeps today’s behaviour with the 40s budget: 3 attempts, 2^n × 1s, 429 retried with backoff', () => {
    expect(OPEN_TARGETS_POLICY).toMatchObject({
      maxAttempts: 3,
      totalBudgetMs: 40_000,
      perAttemptTimeoutMs: 30_000,
      on429: 'retry',
    });
    const backoff = OPEN_TARGETS_POLICY.backoffMs as (attempt: number) => number;
    expect([backoff(1), backoff(2)]).toEqual([1_000, 2_000]);
  });
});

describe('OpenTargetsClient on the shared retry', () => {
  it('recovers from 502, network, 200 with 2^n × 1s backoff, as a POST', async () => {
    const { client, calls, sleep } = stubOpenTargets([502, 'network', 200]);
    await expect(client.query(QUERY)).resolves.toEqual(DATA);
    expect(calls).toHaveLength(3);
    expect(calls[0].method).toBe('post');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
  });

  it('retries a 429 with the usual backoff, ignoring Retry-After', async () => {
    const { client, calls, sleep } = stubOpenTargets([{ status: 429, headers: { 'retry-after': '30' } }, 200]);
    await expect(client.query(QUERY)).resolves.toEqual(DATA);
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000]);

    const exhausted = stubOpenTargets([429]);
    expect(await rejection(exhausted.client.query(QUERY))).toMatchObject({
      platform: 'open-targets',
      kind: 'rate_limited',
      attempts: 3,
    });
    expect(exhausted.calls).toHaveLength(3);
  });

  it('does not retry a GraphQL error response', async () => {
    const { client, calls, sleep } = stubOpenTargets([200], {}, GRAPHQL_ERRORS);
    const error = await rejection(client.query(QUERY));
    expect(error).toBeInstanceOf(GraphQLError);
    expect(error.message).toContain('Cannot query field "nope"');
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry an empty data response', async () => {
    const { client, calls } = stubOpenTargets([200], {}, { data: null });
    expect(await rejection(client.query(QUERY))).toBeInstanceOf(OpenTargetsAPIError);
    expect(calls).toHaveLength(1);
  });

  it('returns partial data that comes with GraphQL errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, calls } = stubOpenTargets([200], {}, { data: DATA, errors: GRAPHQL_ERRORS.errors });
    await expect(client.query(QUERY)).resolves.toEqual(DATA);
    expect(calls).toHaveLength(1);
    warn.mockRestore();
  });

  it('does not retry another 4xx (HTTP 408 included) and surfaces a structured UpstreamError', async () => {
    const bad = stubOpenTargets([400, 200]);
    const error = await rejection(bad.client.query(QUERY));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ platform: 'open-targets', kind: 'bad_request', status: 400, attempts: 1 });
    expect(bad.calls).toHaveLength(1);

    const slow = stubOpenTargets([408, 200]);
    expect(await rejection(slow.client.query(QUERY))).toMatchObject({ status: 408, attempts: 1 });
    expect(slow.calls).toHaveLength(1);
  });

  it('honours constructor maxRetries/retryDelay overrides', async () => {
    const { client, calls, sleep } = stubOpenTargets([503], { maxRetries: 2, retryDelay: 50 });
    expect(await rejection(client.query(QUERY))).toMatchObject({ kind: 'upstream_unavailable', attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50]);

    const longer = stubOpenTargets([429], { maxRetries: 4, retryDelay: 10 });
    await rejection(longer.client.query(QUERY));
    expect(longer.calls).toHaveLength(4);
    expect(longer.sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20, 40]);
  });

  it('serves a cached result without another request', async () => {
    const { client, calls } = stubOpenTargets([200]);
    await client.query(QUERY);
    await client.query(QUERY);
    expect(calls).toHaveLength(1);
  });
});
