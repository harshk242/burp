import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOOL_CALL_MS,
  MAX_REQUEST_RECORDS,
  getToolCallContext,
  resolveToolCallTimeoutMs,
  runWithToolCallContext,
  type RequestRecord,
} from '../tool-call-context.js';
import { rejection, stubClient } from './retry-test-utils.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('tool-call context', () => {
  it('exists only inside runWithToolCallContext', async () => {
    expect(getToolCallContext()).toBeUndefined();
    await runWithToolCallContext({ timeoutMs: 1_000 }, async () => {
      await Promise.resolve();
      expect(getToolCallContext()).toBeDefined();
    });
    expect(getToolCallContext()).toBeUndefined();
  });

  it('aggregates recovered, failed and first-try requests as partial', async () => {
    const recovered = stubClient([500, 200]);
    const failed = stubClient([404]);
    const ok = stubClient([200]);
    const meta = await runWithToolCallContext({ timeoutMs: 5_000 }, async (context) => {
      await recovered.client.get('/sequence/id/A?type=cds');
      await rejection(failed.client.get('/lookup/id/B'));
      await ok.client.post('/vep/human/region', {});
      return context.buildRetryMeta({ isError: false });
    });

    expect(meta).toMatchObject({
      platforms: ['ensembl'],
      request_count: 3,
      attempts: 4,
      retried_requests: 1,
      failed_requests: 1,
      outcome: 'partial',
      requests_truncated: false,
    });
    expect(meta!.total_ms).toBeGreaterThanOrEqual(0);
    expect(meta!.requests.map(({ ms: _ms, ...rest }) => rest)).toEqual<Omit<RequestRecord, 'ms'>[]>([
      {
        platform: 'ensembl',
        method: 'GET',
        path: '/sequence/id/A',
        attempts: 2,
        statuses: [500, 200],
        outcome: 'success',
        reason: null,
      },
      {
        platform: 'ensembl',
        method: 'GET',
        path: '/lookup/id/B',
        attempts: 1,
        statuses: [404],
        outcome: 'failed',
        reason: 'not_found',
      },
      {
        platform: 'ensembl',
        method: 'POST',
        path: '/vep/human/region',
        attempts: 1,
        statuses: [200],
        outcome: 'success',
        reason: null,
      },
    ]);
  });

  it('applies the outcome rules in order', async () => {
    const outcome = async (steps: (number | 'hang')[], isError: boolean, cancel = false) => {
      const controller = new AbortController();
      const { client } = stubClient(steps);
      return runWithToolCallContext({ timeoutMs: 5_000, signal: controller.signal }, async (context) => {
        const request = client.get('/x').catch(() => {});
        if (cancel) controller.abort();
        await request;
        return context.buildRetryMeta({ isError })?.outcome;
      });
    };
    expect(await outcome([200], false)).toBe('success');
    expect(await outcome([500, 200], false)).toBe('recovered');
    expect(await outcome([404], false)).toBe('partial');
    expect(await outcome([404], true)).toBe('failed');
    expect(await outcome(['hang'], true, true)).toBe('cancelled');
  });

  it('keeps 20 records out of 25 and sets requests_truncated', async () => {
    const { client } = stubClient([200]);
    const meta = await runWithToolCallContext({ timeoutMs: 5_000 }, async (context) => {
      for (let i = 0; i < 25; i++) await client.get(`/item/${i}`);
      return context.buildRetryMeta({ isError: false });
    });
    expect(meta!.request_count).toBe(25);
    expect(meta!.attempts).toBe(25);
    expect(meta!.requests).toHaveLength(MAX_REQUEST_RECORDS);
    expect(meta!.requests[19].path).toBe('/item/19');
    expect(meta!.requests_truncated).toBe(true);
  });

  it('builds no meta when the call made no upstream request', async () => {
    const meta = await runWithToolCallContext({ timeoutMs: 1_000 }, (context) =>
      context.buildRetryMeta({ isError: false }),
    );
    expect(meta).toBeUndefined();
  });

  it('records the platform in first-use order and a request skipped at the deadline', async () => {
    const { client } = stubClient([200]);
    const pending = runWithToolCallContext({ timeoutMs: 20 }, async (context) => {
      await client.get('/a');
      await new Promise((resolve) => setTimeout(resolve, 40));
      await client.get('/b').catch(() => {});
      return context.buildRetryMeta({ isError: false });
    });
    await vi.advanceTimersByTimeAsync(40);
    const meta = await pending;
    expect(meta!.requests[1]).toMatchObject({ attempts: 0, statuses: [], reason: 'budget_timeout' });
    expect(meta!.outcome).toBe('partial');
  });

  it('derives the tool-call time from _meta.deadline_ms', () => {
    expect(resolveToolCallTimeoutMs(60_000)).toBe(55_000);
    expect(resolveToolCallTimeoutMs(undefined)).toBe(DEFAULT_TOOL_CALL_MS);
    expect(resolveToolCallTimeoutMs('60000')).toBe(DEFAULT_TOOL_CALL_MS);
    expect(resolveToolCallTimeoutMs(8_000)).toBe(3_000);
    expect(resolveToolCallTimeoutMs(5_000)).toBe(0);
    expect(resolveToolCallTimeoutMs(4_000)).toBe(0);
  });

  it('fails requests as timeout without sending them when the deadline leaves no time', async () => {
    const { client, calls } = stubClient([200]);
    const error = await runWithToolCallContext({ timeoutMs: resolveToolCallTimeoutMs(4_000) }, () =>
      rejection(client.get('/x')),
    );
    expect(error).toMatchObject({ kind: 'timeout', reason: 'budget_timeout', attempts: 0 });
    expect(calls).toHaveLength(0);
  });

  it('keeps concurrent tool calls isolated: records, deadlines and signals', async () => {
    const a = stubClient([{ status: 200, delayMs: 30 }]);
    const b = stubClient(['hang']);
    const controllerB = new AbortController();
    const callA = runWithToolCallContext({ timeoutMs: 1_000 }, async (context) => {
      await a.client.get('/a/1');
      await a.client.get('/a/2');
      return { meta: context.buildRetryMeta({ isError: false }), remaining: context.remainingMs() };
    });
    const callB = runWithToolCallContext({ timeoutMs: 50, signal: controllerB.signal }, async (context) => {
      await b.client.get('/b/1').catch(() => {});
      return { meta: context.buildRetryMeta({ isError: true }), remaining: context.remainingMs() };
    });
    await vi.advanceTimersByTimeAsync(60);
    const [resultA, resultB] = await Promise.all([callA, callB]);

    expect(resultA.meta!.requests.map((r) => r.path)).toEqual(['/a/1', '/a/2']);
    expect(resultA.meta!.outcome).toBe('success');
    expect(resultA.remaining).toBe(940);
    expect(resultB.meta!.requests).toEqual([expect.objectContaining({ path: '/b/1', reason: 'budget_timeout' })]);
    expect(resultB.meta!.outcome).toBe('failed');
    expect(resultB.remaining).toBe(0);
  });
});
