import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_CALL_MS,
  MAX_REQUEST_RECORDS,
  getToolCallContext,
  resolveToolCallTimeoutMs,
  runWithToolCallContext,
  type RequestRecord,
} from '../tool-call-context.js';
import { rejection, stubClient } from './retry-test-utils.js';

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
        if (cancel) setTimeout(() => controller.abort(), 10);
        await client.get('/x').catch(() => {});
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
    const meta = await runWithToolCallContext({ timeoutMs: 20 }, async (context) => {
      await client.get('/a');
      await new Promise((resolve) => setTimeout(resolve, 40));
      await client.get('/b').catch(() => {});
      return context.buildRetryMeta({ isError: false });
    });
    expect(meta!.requests[1]).toMatchObject({ attempts: 0, statuses: [], reason: 'budget_timeout' });
    expect(meta!.outcome).toBe('partial');
  });

  it('derives the tool-call time from _meta.deadline_ms', () => {
    expect(resolveToolCallTimeoutMs(60_000)).toBe(55_000);
    expect(resolveToolCallTimeoutMs(undefined)).toBe(DEFAULT_TOOL_CALL_MS);
    expect(resolveToolCallTimeoutMs('60000')).toBe(DEFAULT_TOOL_CALL_MS);
    expect(resolveToolCallTimeoutMs(4_000)).toBe(2_000);
  });
});
