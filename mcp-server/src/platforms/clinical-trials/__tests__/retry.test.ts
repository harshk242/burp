import { AxiosError, AxiosHeaders, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { UpstreamError } from '../../../shared/exceptions.js';
import { callTool, rejection, stubAdapter, toolText, type Step } from '../../../shared/__tests__/retry-test-utils.js';
import { CLINICAL_TRIALS_POLICY, resetClient, fetchStudies, initClient } from '../client.js';
import { handlers } from '../tools/index.js';

function stubClinicalTrials(steps: Step[]) {
  const { adapter, calls } = stubAdapter(steps);
  initClient({}, { adapter, retryDeps: { sleep: async () => {} } });
  return calls;
}

function failWith(status: number, body: unknown, contentType: string) {
  const calls: unknown[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const response = {
      data: body,
      status,
      statusText: String(status),
      headers: new AxiosHeaders({ 'content-type': contentType }),
      config,
    };
    const code = status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST;
    throw new AxiosError(`Request failed with status code ${status}`, code, config, null, response);
  };
  initClient({}, { adapter, retryDeps: { sleep: async () => {} } });
  return calls;
}

afterEach(() => {
  resetClient();
});

describe('CLINICAL_TRIALS_POLICY', () => {
  it('stays at one attempt, now with a 40s request budget', () => {
    expect(CLINICAL_TRIALS_POLICY).toMatchObject({ maxAttempts: 1, totalBudgetMs: 40_000, perAttemptTimeoutMs: 30_000 });
  });
});

describe('ClinicalTrials tools on the shared retry', () => {
  it('makes exactly 1 attempt on a 5xx and returns the structured upstream error', async () => {
    const calls = stubClinicalTrials([503, 200]);
    const result = await callTool(handlers, 'search_studies', { condition: 'melanoma' });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(toolText(result))).toMatchObject({
      error: 'upstream_unavailable',
      reason: 'http_5xx',
      platform: 'clinicaltrials',
      status: 503,
      attempts: 1,
      retryable_later: true,
    });
  });

  it.each(['network', 'timeout'] as const)('makes exactly 1 attempt on a %s failure', async (step) => {
    const calls = stubClinicalTrials([step, 200]);
    const result = await callTool(handlers, 'search_studies', { condition: 'melanoma' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(toolText(result))).toMatchObject({ platform: 'clinicaltrials', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('clamps the attempt timeout to the tool-call deadline', async () => {
    const calls = stubClinicalTrials([200]);
    const result = await callTool(handlers, 'search_studies', { condition: 'melanoma' }, { deadline_ms: 8_000 });
    expect(result.isError).toBeUndefined();
    expect(calls[0].timeout).toBeGreaterThan(0);
    expect(calls[0].timeout).toBeLessThanOrEqual(3_000);
  });
});

describe('fetchStudies API error messages', () => {
  it('keeps the API’s plain-text message in the structured tool error', async () => {
    const apiText = 'Invalid value in parameter `overallStatus`: `NOTASTATUS`';
    const calls = failWith(400, apiText, 'text/plain; charset=UTF-8');
    const result = await callTool(handlers, 'search_studies', { condition: 'melanoma' });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(toolText(result));
    expect(payload).toMatchObject({
      error: 'bad_request',
      reason: 'bad_request',
      platform: 'clinicaltrials',
      status: 400,
      attempts: 1,
      retryable_later: false,
    });
    expect(payload.message).toContain(`ClinicalTrials API error: ${apiText}.`);
  });

  it('keeps a JSON `message` from a serialized body in the tool error', async () => {
    failWith(400, JSON.stringify({ message: 'Unknown field `Nope`' }), 'application/json');
    const result = await callTool(handlers, 'search_studies', { condition: 'melanoma' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(toolText(result));
    expect(payload).toMatchObject({ error: 'bad_request', status: 400, attempts: 1 });
    expect(payload.message).toContain('ClinicalTrials API error: Unknown field `Nope`.');
  });

  it('keeps a JSON `message` too, with the structured fields and cause intact', async () => {
    failWith(400, JSON.stringify({ message: 'Unknown field `Nope`' }), 'application/json');
    const error = await rejection(fetchStudies({ fields: 'Nope' }));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.message).toMatch(/^ClinicalTrials API error: Unknown field `Nope`\. /);
    expect(error).toMatchObject({ kind: 'bad_request', status: 400, attempts: 1, url: '/api/v2/studies' });
    expect(error.cause).toBeInstanceOf(AxiosError);
  });

  it('leaves an HTML error page out of the message', async () => {
    failWith(502, '<html><body>Bad Gateway</body></html>', 'text/html');
    const error = await rejection(fetchStudies({}));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.message).not.toMatch(/ClinicalTrials API error|<html>/);
    expect(error).toMatchObject({ kind: 'upstream_unavailable', status: 502 });
  });
});
