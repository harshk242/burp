import { afterEach, describe, expect, it } from 'vitest';
import { callTool, stubAdapter, toolText } from '../../../shared/__tests__/retry-test-utils.js';
import { EMA_MEDICINES_PATH, OPENFDA_POLICY, initClient, resetClient } from '../client.js';
import { emaDate } from '../ema.js';
import { handlers } from '../handlers.js';
import { ema, fakeApis } from './fixtures.js';

type Result = Record<string, any>;

const dataset = {
  meta: { total_records: 5, timestamp: '2026-11-16T18:03:48Z' },
  data: [
    ema({ name_of_medicine: 'Blenrep', active_substance: 'belantamab mafodotin', medicine_status: 'Authorised', marketing_authorisation_date: '23/07/2025', therapeutic_area_mesh: 'Multiple Myeloma' }),
    ema({ name_of_medicine: 'Blenrep', active_substance: 'belantamab mafodotin', medicine_status: 'Expired', marketing_authorisation_date: '25/08/2020', withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date: '23/02/2024', conditional_approval: 'Yes', orphan_medicine: 'Yes' }),
    ema({ name_of_medicine: 'Itvisma', active_substance: 'onasemnogene abeparvovec', therapeutic_area_mesh: 'Muscular Atrophy, Spinal', therapeutic_indication: 'Treatment of spinal muscular atrophy (SMA).', marketing_authorisation_date: '30/06/2026' }),
    ema({ name_of_medicine: 'Isembyld', active_substance: 'apitegromab', medicine_status: 'Application withdrawn', marketing_authorisation_date: '', withdrawal_of_application_date: '01/09/2026', therapeutic_indication: 'spinal muscular atrophy' }),
    ema({ category: 'Veterinary', name_of_medicine: 'Blenrep-vet' }),
  ],
};

function setup(data: unknown = dataset) {
  const { adapter, seen } = fakeApis((config) => (config.url === EMA_MEDICINES_PATH ? { data } : undefined));
  initClient({}, { adapter, retryDeps: { sleep: async () => {} } });
  return seen;
}

afterEach(resetClient);

it('parses EMA dd/mm/yyyy dates', () => {
  expect(emaDate('23/07/2025')).toBe('2025-07-23');
  expect(emaDate('')).toBeNull();
  expect(emaDate('2025-07-23')).toBeNull();
});

describe('search_ema_medicines', () => {
  it('matches names and substances, keeps withdrawn records, newest first, human only', async () => {
    setup();
    const result = await handlers.search_ema_medicines!({ query: 'BLENREP' }) as Result;
    expect(result.medicines.map((m: Result) => [m.status, m.marketing_authorisation_date, m.withdrawal_expiry_revocation_lapse_date])).toEqual([
      ['Authorised', '2025-07-23', null],
      ['Expired', '2020-08-25', '2024-02-23'],
    ]);
    expect(result.medicines[1].flags).toEqual(['conditional_approval', 'orphan_medicine']);
    expect(result.data_timestamp).toBe('2026-11-16T18:03:48Z');
    expect(result.coverage_note).toMatch(/nationally/);
  });

  it('finds medicines by therapeutic area or indication text', async () => {
    setup();
    const result = await handlers.search_ema_medicines!({ therapeutic_area: 'spinal muscular atrophy' }) as Result;
    expect(result.medicines.map((m: Result) => [m.name, m.status])).toEqual([['Itvisma', 'Authorised'], ['Isembyld', 'Application withdrawn']]);
  });

  it('filters by status and authorisation window', async () => {
    setup();
    const authorised = await handlers.search_ema_medicines!({ therapeutic_area: 'spinal', status: 'Authorised' }) as Result;
    expect(authorised.medicines.map((m: Result) => m.name)).toEqual(['Itvisma']);
    const recent = await handlers.search_ema_medicines!({ authorised_from: '2025-01-01', authorised_to: '2025-12-31' }) as Result;
    expect(recent.medicines.map((m: Result) => m.name)).toEqual(['Blenrep']);
    const limited = await handlers.search_ema_medicines!({ query: 'blenrep', limit: 1 }) as Result;
    expect(limited).toMatchObject({ total_matches: 2, returned: 1 });
  });

  it('downloads the file once and reuses it', async () => {
    const seen = setup();
    await handlers.search_ema_medicines!({ query: 'a' });
    await handlers.search_ema_medicines!({ query: 'b' });
    expect(seen).toHaveLength(1);
  });

  it('does not cache a failed download', async () => {
    const seen = setup({ unexpected: true });
    await expect(handlers.search_ema_medicines!({ query: 'a' })).rejects.toThrow(/unexpected shape/);
    await expect(handlers.search_ema_medicines!({ query: 'a' })).rejects.toThrow(/unexpected shape/);
    expect(seen).toHaveLength(2);
  });

  it.each([
    [{}, /Give a query/],
    [{ query: 'a', status: 'approved' }, /status must be one of/],
    [{ authorised_from: '01/01/2025' }, /YYYY-MM-DD/],
  ])('rejects invalid arguments %j', async (args, message) => {
    setup();
    await expect(handlers.search_ema_medicines!(args)).rejects.toThrow(message);
  });
});

describe('shared retry', () => {
  it('retries a transient openFDA 500 and then succeeds', async () => {
    expect(OPENFDA_POLICY.maxAttempts).toBe(3);
    const { adapter, calls } = stubAdapter([500, 200]);
    initClient({}, { adapter, retryDeps: { sleep: async () => {} } });
    const result = await callTool(handlers, 'search_fda_approvals', { drug: 'Blenrep' });
    expect(result.isError).toBeUndefined();
    // Two attempts at Drugs@FDA; its empty stub body then sends the handler on to the label fallback.
    expect(calls.map((c) => c.url)).toEqual(['/drug/drugsfda.json', '/drug/drugsfda.json', '/drug/label.json']);
  });

  it('returns the structured upstream error after the last attempt', async () => {
    const { adapter, calls } = stubAdapter([503, 503, 503]);
    initClient({}, { adapter, retryDeps: { sleep: async () => {} } });
    const result = await callTool(handlers, 'search_fda_approvals', { drug: 'Blenrep' });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(3);
    expect(JSON.parse(toolText(result))).toMatchObject({ error: 'upstream_unavailable', platform: 'openfda', attempts: 3 });
  });
});
