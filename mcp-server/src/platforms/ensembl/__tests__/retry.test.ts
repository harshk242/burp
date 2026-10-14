import { afterEach, describe, expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { createCallToolHandler } from '../../../call-tool.js';
import { runWithToolCallContext, type RetryMeta } from '../../../shared/tool-call-context.js';
import { fakeClock, stubAdapter, type FakeClock, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { ENSEMBL_POLICY, cleanup, init } from '../client.js';
import { handlers } from '../tools/index.js';

function stubEnsembl(steps: Step[], clock?: FakeClock) {
  const { adapter, calls } = stubAdapter(steps, clock);
  init({}, { adapter, retryDeps: { sleep: async () => {}, ...(clock ? { now: clock.now } : {}) } });
  return calls;
}

function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const handle = createCallToolHandler(new Map(Object.entries(handlers)));
  return handle(
    { method: 'tools/call', params: { name, arguments: args } },
    { signal: new AbortController().signal },
  );
}

function text(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type !== 'text') throw new Error('expected text content');
  return item.text;
}

afterEach(() => {
  cleanup();
});

describe('ENSEMBL_POLICY', () => {
  it('matches the plan: 3 attempts, 1s/3s ±25%, 30s attempts, 40s budget, 429 waits', () => {
    expect(ENSEMBL_POLICY).toMatchObject({
      maxAttempts: 3,
      backoffMs: [1_000, 3_000],
      jitter: 0.25,
      perAttemptTimeoutMs: 30_000,
      totalBudgetMs: 40_000,
      on429: 'wait',
    });
  });
});

describe('Ensembl tools on the shared retry', () => {
  it('recovers from 500, 500, 200 and reports _meta.retry.outcome = recovered', async () => {
    const calls = stubEnsembl([500, 500, 200]);
    const result = await callTool('lookup_gene', { gene_id: 'ENSG00000139618' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result))).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    const retry = result._meta?.retry as RetryMeta;
    expect(retry).toMatchObject({ platforms: ['ensembl'], request_count: 1, attempts: 3, outcome: 'recovered' });
    expect(retry.requests[0]).toMatchObject({ path: '/lookup/id/ENSG00000139618', statuses: [500, 500, 200] });
  });
});

describe('search_genes', () => {
  it('returns the structured upstream_unavailable error on a 5xx, not "No gene found"', async () => {
    const calls = stubEnsembl([503]);
    const result = await callTool('search_genes', { query: 'BRCA2' });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(3);
    const payload = JSON.parse(text(result));
    expect(payload).toMatchObject({
      error: 'upstream_unavailable',
      reason: 'http_5xx',
      platform: 'ensembl',
      status: 503,
      attempts: 3,
      retryable_later: true,
    });
    expect(payload.message).not.toMatch(/No gene found/);
  });

  it('returns the structured timeout error when every attempt times out', async () => {
    stubEnsembl(['timeout']);
    const payload = JSON.parse(text(await callTool('search_genes', { query: 'BRCA2' })));
    expect(payload).toMatchObject({ error: 'timeout', reason: 'attempt_timeout' });
  });

  it.each([404, 400])('still returns "No gene found" on a %i, without retrying', async (status) => {
    const calls = stubEnsembl([status]);
    const result = await callTool('search_genes', { query: 'NOTAGENE' });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(text(result)).toMatch(/^Error: No gene found with symbol: NOTAGENE\./);
  });
});

describe('batch_sequence_fetch', () => {
  it('marks the remaining regions skipped: deadline once the tool-call deadline is gone', async () => {
    const clock = fakeClock();
    const calls = stubEnsembl([{ status: 200, advanceMs: 20_000 }], clock);

    const result = await runWithToolCallContext({ timeoutMs: 10_000, now: clock.now }, () =>
      handlers.batch_sequence_fetch({ regions: ['1:1-100', '2:1-100', 'ENST00000380152'] }),
    );

    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      batch_results: [
        { region: '1:1-100', success: true, data: { ok: true } },
        { region: '2:1-100', success: false, skipped: 'deadline' },
        { region: 'ENST00000380152', success: false, skipped: 'deadline' },
      ],
    });
  });

  it('still records per-region errors and keeps going while time is left', async () => {
    const calls = stubEnsembl([404, 200]);
    const result = await runWithToolCallContext({ timeoutMs: 10_000 }, () =>
      handlers.batch_sequence_fetch({ regions: ['1:1-100', '2:1-100'] }),
    );

    expect(calls).toHaveLength(2);
    const [first, second] = (result as { batch_results: Record<string, unknown>[] }).batch_results;
    expect(first).toMatchObject({ region: '1:1-100', success: false });
    expect(first.error).toMatch(/HTTP 404/);
    expect(second).toEqual({ region: '2:1-100', success: true, data: { ok: true } });
  });
});
