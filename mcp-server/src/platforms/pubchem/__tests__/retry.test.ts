import { afterEach, describe, expect, it } from 'vitest';

import { callTool, stubAdapter, toolText, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { PUBCHEM_POLICY, resetClient, initClient } from '../client.js';
import { handlers } from '../tools/index.js';

function stubPubChem(steps: Step[]) {
  const { adapter, calls } = stubAdapter(steps);
  initClient({}, { adapter, retryDeps: { sleep: async () => {} } });
  return calls;
}

afterEach(() => {
  resetClient();
});

describe('PUBCHEM_POLICY', () => {
  it('stays at one attempt, now with a 40s request budget', () => {
    expect(PUBCHEM_POLICY).toMatchObject({ maxAttempts: 1, totalBudgetMs: 40_000, perAttemptTimeoutMs: 30_000 });
  });
});

describe('PubChem tools on the shared retry', () => {
  it('makes exactly 1 attempt on a 5xx and returns the structured upstream error', async () => {
    const calls = stubPubChem([503, 200]);
    const result = await callTool(handlers, 'get_compound_info', { cid: 2244 });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(toolText(result))).toMatchObject({
      error: 'upstream_unavailable',
      reason: 'http_5xx',
      platform: 'pubchem',
      status: 503,
      attempts: 1,
      retryable_later: true,
    });
  });

  it.each(['network', 'timeout'] as const)('makes exactly 1 attempt on a %s failure', async (step) => {
    const calls = stubPubChem([step, 200]);
    const result = await callTool(handlers, 'get_compound_info', { cid: 2244 });
    expect(result.isError).toBe(true);
    expect(JSON.parse(toolText(result))).toMatchObject({ platform: 'pubchem', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('clamps the attempt timeout to the tool-call deadline', async () => {
    const calls = stubPubChem([200]);
    const result = await callTool(handlers, 'get_compound_info', { cid: 2244 }, { deadline_ms: 8_000 });
    expect(result.isError).toBeUndefined();
    expect(calls[0].timeout).toBeGreaterThan(0);
    expect(calls[0].timeout).toBeLessThanOrEqual(3_000);
  });

  it('batch_compound_lookup records the per-CID upstream message and keeps going', async () => {
    const calls = stubPubChem([503, 200]);
    const result = await callTool(handlers, 'batch_compound_lookup', { cids: [1, 2] });
    const [first, second] = JSON.parse(toolText(result)).batch_results;
    expect(calls).toHaveLength(2);
    expect(first).toMatchObject({ cid: 1, success: false });
    expect(first.error).toMatch(/^Pubchem returned HTTP 503 on 1 attempt/);
    expect(second).toMatchObject({ cid: 2, success: true });
  });
});
