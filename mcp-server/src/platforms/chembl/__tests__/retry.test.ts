import { afterEach, describe, expect, it } from 'vitest';

import { callTool, stubAdapter, toolText, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { CHEMBL_POLICY, cleanup, init } from '../client.js';
import { handlers } from '../tools/index.js';

function stubChembl(steps: Step[]) {
  const { adapter, calls } = stubAdapter(steps);
  init({}, { adapter, retryDeps: { sleep: async () => {} } });
  return calls;
}

afterEach(() => {
  cleanup();
});

describe('CHEMBL_POLICY', () => {
  it('stays at one attempt, now with a 40s request budget', () => {
    expect(CHEMBL_POLICY).toMatchObject({ maxAttempts: 1, totalBudgetMs: 40_000, perAttemptTimeoutMs: 30_000 });
  });
});

describe('ChEMBL tools on the shared retry', () => {
  it('makes exactly 1 attempt on a 5xx and returns the structured upstream error', async () => {
    const calls = stubChembl([503, 200]);
    const result = await callTool(handlers, 'get_compound_info', { chembl_id: 'CHEMBL25' });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(toolText(result))).toMatchObject({
      error: 'upstream_unavailable',
      reason: 'http_5xx',
      platform: 'chembl',
      status: 503,
      attempts: 1,
      retryable_later: true,
    });
  });

  it.each(['network', 'timeout'] as const)('makes exactly 1 attempt on a %s failure', async (step) => {
    const calls = stubChembl([step, 200]);
    const result = await callTool(handlers, 'get_compound_info', { chembl_id: 'CHEMBL25' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(toolText(result))).toMatchObject({ platform: 'chembl', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('clamps the attempt timeout to the tool-call deadline', async () => {
    const calls = stubChembl([200]);
    const result = await callTool(handlers, 'get_compound_info', { chembl_id: 'CHEMBL25' }, { deadline_ms: 8_000 });
    expect(result.isError).toBeUndefined();
    expect(calls[0].timeout).toBeGreaterThan(0);
    expect(calls[0].timeout).toBeLessThanOrEqual(3_000);
  });
});

describe('get_external_references', () => {
  it('falls back to the target lookup when the molecule is not found', async () => {
    const calls = stubChembl([404, 200]);
    const result = await callTool(handlers, 'get_external_references', { chembl_id: 'CHEMBL203' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(toolText(result))).toMatchObject({ entity_type: 'target' });
    expect(calls.map((c) => c.url)).toEqual(['/molecule/CHEMBL203.json', '/target/CHEMBL203.json']);
  });

  it('still reports "not found" when neither lookup finds the ID', async () => {
    stubChembl([404]);
    const result = await callTool(handlers, 'get_external_references', { chembl_id: 'CHEMBL0' });
    expect(toolText(result)).toMatch(/^Error: ChEMBL ID not found as molecule or target/);
  });

  it('returns the structured error on an outage instead of "not found"', async () => {
    const calls = stubChembl([503]);
    const result = await callTool(handlers, 'get_external_references', { chembl_id: 'CHEMBL25' });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(toolText(result))).toMatchObject({ error: 'upstream_unavailable', platform: 'chembl' });
  });
});
