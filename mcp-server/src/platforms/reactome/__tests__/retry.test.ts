import { afterEach, describe, expect, it } from 'vitest';

import { callTool, stubAdapter, toolText, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { REACTOME_POLICY, resetClient, initClient } from '../client.js';
import { handlers } from '../handlers.js';

function stubReactome(steps: Step[]) {
  const { adapter, calls } = stubAdapter(steps);
  initClient({}, { adapter, retryDeps: { sleep: async () => {} } });
  return calls;
}

afterEach(() => {
  resetClient();
});

describe('REACTOME_POLICY', () => {
  it('stays at one attempt, now with a 40s request budget', () => {
    expect(REACTOME_POLICY).toMatchObject({ maxAttempts: 1, totalBudgetMs: 40_000, perAttemptTimeoutMs: 30_000 });
  });
});

describe('Reactome tools on the shared retry', () => {
  it('makes exactly 1 attempt on a 5xx and returns the structured upstream error', async () => {
    const calls = stubReactome([502, 200]);
    const result = await callTool(handlers, 'search_pathways', { query: 'apoptosis' });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(toolText(result))).toMatchObject({
      error: 'upstream_unavailable',
      reason: 'http_5xx',
      platform: 'reactome',
      status: 502,
      attempts: 1,
      retryable_later: true,
    });
  });

  it.each(['network', 'timeout'] as const)('makes exactly 1 attempt on a %s failure', async (step) => {
    const calls = stubReactome([step, 200]);
    const result = await callTool(handlers, 'search_pathways', { query: 'apoptosis' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(toolText(result))).toMatchObject({ platform: 'reactome', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('clamps the attempt timeout to the tool-call deadline', async () => {
    const calls = stubReactome([200]);
    const result = await callTool(handlers, 'search_pathways', { query: 'apoptosis' }, { deadline_ms: 8_000 });
    expect(result.isError).toBeUndefined();
    expect(calls[0].timeout).toBeGreaterThan(0);
    expect(calls[0].timeout).toBeLessThanOrEqual(3_000);
  });
});

describe('pathway name resolution', () => {
  it('still reports "No pathway found" when the search has no hits (404)', async () => {
    const calls = stubReactome([404]);
    const result = await callTool(handlers, 'get_pathway_details', { id: 'not a pathway' });
    expect(calls).toHaveLength(1);
    expect(toolText(result)).toMatch(/^Error: No pathway found for identifier: not a pathway\./);
  });

  it('returns the structured error on an outage instead of "No pathway found"', async () => {
    const calls = stubReactome([503]);
    const result = await callTool(handlers, 'get_pathway_details', { id: 'glycolysis' });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(toolText(result))).toMatchObject({ error: 'upstream_unavailable', platform: 'reactome' });
  });
});
