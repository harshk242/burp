import { afterEach, describe, expect, it } from 'vitest';

import { callTool, stubAdapter, toolText, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { UNIPROT_POLICY, resetClient, initClient } from '../client.js';
import { platform } from '../index.js';

const { handlers } = platform;

function stubUniProt(steps: Step[]) {
  const { adapter, calls } = stubAdapter(steps);
  initClient({}, { adapter, retryDeps: { sleep: async () => {} } });
  return calls;
}

afterEach(() => {
  resetClient();
});

describe('UNIPROT_POLICY', () => {
  it('stays at one attempt, now with a 40s request budget', () => {
    expect(UNIPROT_POLICY).toMatchObject({ maxAttempts: 1, totalBudgetMs: 40_000, perAttemptTimeoutMs: 30_000 });
  });
});

describe('UniProt tools on the shared retry', () => {
  it('makes exactly 1 attempt on a 5xx and returns the structured upstream error', async () => {
    const calls = stubUniProt([500, 200]);
    const result = await callTool(handlers, 'get_protein_info', { accession: 'P04637' });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(toolText(result))).toMatchObject({
      error: 'upstream_unavailable',
      reason: 'http_5xx',
      platform: 'uniprot',
      status: 500,
      attempts: 1,
      retryable_later: true,
    });
  });

  it.each(['network', 'timeout'] as const)('makes exactly 1 attempt on a %s failure', async (step) => {
    const calls = stubUniProt([step, 200]);
    const result = await callTool(handlers, 'get_protein_info', { accession: 'P04637' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(toolText(result))).toMatchObject({ platform: 'uniprot', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('clamps the attempt timeout to the tool-call deadline', async () => {
    const calls = stubUniProt([200]);
    const result = await callTool(handlers, 'get_protein_info', { accession: 'P04637' }, { deadline_ms: 8_000 });
    expect(result.isError).toBeUndefined();
    expect(calls[0].timeout).toBeGreaterThan(0);
    expect(calls[0].timeout).toBeLessThanOrEqual(3_000);
  });
});

describe('validate_accession', () => {
  it.each([404, 400])('still reports isValid: false when UniProt rejects the accession (%i)', async (status) => {
    const calls = stubUniProt([status]);
    const result = await callTool(handlers, 'validate_accession', { accession: 'P00000' });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(toolText(result))).toEqual({ accession: 'P00000', isValid: false, exists: false });
  });

  it('returns the structured error on an outage instead of isValid: false', async () => {
    const calls = stubUniProt([503]);
    const result = await callTool(handlers, 'validate_accession', { accession: 'P04637' });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(toolText(result))).toMatchObject({ error: 'upstream_unavailable', platform: 'uniprot' });
  });
});

describe('search_by_function', () => {
  it.each(['GO:0005524', '0005524'])('queries a bare numeric GO ID for %s', async (goTerm) => {
    const calls = stubUniProt([200]);
    const result = await callTool(handlers, 'search_by_function', {
      goTerm,
      function: 'ATP binding',
      organism: 'Homo sapiens',
    });
    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({
      query: 'reviewed:true AND go:0005524 AND (cc_function:"ATP binding" OR ft_act_site:"ATP binding") AND organism_name:"Homo sapiens"',
      format: 'json',
      size: 25,
    });
  });
});
