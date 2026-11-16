import axios from 'axios';
import { afterAll, describe, expect, it } from 'vitest';
import { createChemblClient, init, resetClient } from '../client.js';
import { platform } from '../index.js';
import { pace, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants } from './tool-args.js';
import { assertChemblRequest, schemas } from './request-contract.js';
const transport = axios.getAdapter(axios.defaults.adapter);
afterAll(resetClient);

// HTTP 200 cannot detect ChEMBL's silently ignored parameters.
function assertFilters(data: any, params: Record<string, unknown>) {
  const rows = data.molecules ?? data.targets ?? data.activities ?? data.drug_indications ?? data.mechanisms ?? [];
  for (const [key, expected] of Object.entries(params)) {
    if (['q', 'limit', 'offset'].includes(key)) continue;
    const parts = key.split('__');
    const op = ['gte', 'lte', 'icontains'].includes(parts.at(-1)!) ? parts.pop() : 'exact';
    for (const row of rows) {
      const actual = parts.reduce((v, p) => v?.[p], row);
      expect(actual, key).not.toBeNull();
      expect(actual, key).not.toBeUndefined();
      if (op === 'gte') expect(Number(actual), key).toBeGreaterThanOrEqual(Number(expected));
      else if (op === 'lte') expect(Number(actual), key).toBeLessThanOrEqual(Number(expected));
      else if (op === 'icontains') expect(String(actual).toLowerCase(), key).toContain(String(expected).toLowerCase());
      else if (key === 'max_phase') expect(Number(actual), key).toBe(Number(expected));
      else expect(String(actual), key).toBe(String(expected));
    }
  }
}
async function invoke(name: string, args: Record<string, unknown>) {
  let requests = 0;
  const failures: unknown[] = [];
  init({}, { adapter: async config => {
    await pace(350);
    try {
      const recorder = requestRecorder();
      await recorder.adapter(config);
      assertChemblRequest(recorder.requests[0]);
      requests++;
      const response = await transport(config);
      expect(response.status).toBe(200);
      const url = new URL(recorder.requests[0].url);
      const data = typeof response.data === 'string' && !url.pathname.endsWith('.sdf') ? JSON.parse(response.data) : response.data;
      assertFilters(data, { ...Object.fromEntries(url.searchParams), ...config.params });
      return response;
    } catch (error) { failures.push(error); throw error; }
  } });
  try {
    const result = await platform.handlers[name](args) as any;
    expect(failures).toEqual([]); // Catch errors swallowed by batch/comparison tools.
    expect(requests).toBeGreaterThan(0);
    expect(result).toBeDefined();
    if (name === 'get_compound_structure') expect(result.structure).toBeTruthy();
    return result;
  } finally { resetClient(); }
}
function compact(s: any): any {
  return { ...(s.filtering ? { filtering: s.filtering } : {}), fields: Object.fromEntries(
    Object.entries(s.fields ?? {}).map(([k, v]: [string, any]) => [k, v.schema ? compact(v.schema) : {}])) };
}
it('matches saved resource fields and filters against live schemas', async () => {
  const http = createChemblClient();
  for (const [resource, schema] of Object.entries(schemas)) {
    await pace(350);
    expect(compact((await http.get(`/${resource}/schema.json`)).data), resource).toEqual(schema);
  }
});
describe.each(platform.tools)('$name live handler', tool => {
  it.each(argVariants(tool))('$label is accepted and returned filters hold', async ({ args }) => { await invoke(tool.name, args); });
});
it('returns different, relevant asthma and melanoma indications', async () => {
  const a = await invoke('search_drug_indications', { indication: 'asthma', limit: 5 });
  const b = await invoke('search_drug_indications', { indication: 'melanoma', limit: 5 });
  for (const result of [a, b]) expect(result.drug_indications.length).toBeGreaterThan(0);
  expect(a.page_meta.total_count).not.toBe(b.page_meta.total_count);
  expect(a.drug_indications.map((r: any) => r.drugind_id)).not.toEqual(b.drug_indications.map((r: any) => r.drugind_id));
});
it('target type and organism independently narrow searches', async () => {
  const args = { query: 'kinase', limit: 3 };
  const all = await invoke('search_targets', args);
  for (const filter of [{ target_type: 'PROTEIN COMPLEX' }, { organism: 'Homo sapiens' }]) {
    const result = await invoke('search_targets', { ...args, ...filter });
    expect(result.targets.length).toBeGreaterThan(0);
    expect(result.page_meta.total_count).toBeLessThan(all.page_meta.total_count);
  }
});
it('development phase changes results before pagination', async () => {
  const a = await invoke('search_drugs', { query: 'aspirin', development_phase: 'Approved', limit: 5 });
  const b = await invoke('search_drugs', { query: 'aspirin', development_phase: 'Phase III', limit: 5 });
  expect(a.drugs.length).toBeGreaterThan(0);
  expect(b.drugs.length).toBeGreaterThan(0);
  expect(a.drugs.map((r: any) => r.molecule_chembl_id)).not.toEqual(b.drugs.map((r: any) => r.molecule_chembl_id));
});
// Nonempty individual probes prevent full-args conjunctions making checks vacuous.
const probes: Array<[string, Record<string, unknown>, string]> = [
  ...Object.entries({ target_chembl_id: 'CHEMBL203', molecule_chembl_id: 'CHEMBL25', assay_chembl_id: 'CHEMBL655942', activity_type: 'IC50' })
    .map(([key, value]) => ['search_activities', { [key]: value, limit: 2 }, 'activities'] as [string, Record<string, unknown>, string]),
  ['search_by_activity_type', { activity_type: 'IC50', min_value: 100, limit: 2 }, 'activities'],
  ['search_by_activity_type', { activity_type: 'IC50', max_value: 100, limit: 2 }, 'activities'],
  ['search_by_activity_type', { activity_type: 'IC50', units: 'nM', limit: 2 }, 'activities'],
  ...Object.entries({ min_mw: 500, max_mw: 100, min_logp: 5, max_logp: 0, max_hbd: 0, max_hba: 0 })
    .map(([key, value]) => ['advanced_search', { [key]: value, limit: 2 }, 'molecules'] as [string, Record<string, unknown>, string]),
  ['get_mechanism_of_action', { chembl_id: 'CHEMBL25' }, 'mechanisms'],
  ['get_drug_info', { chembl_id: 'CHEMBL25' }, 'indications'],
];
it.each(probes)('%s applies %j to nonempty results', async (name, args, collection) => {
  const result = await invoke(name, args);
  expect((name === 'advanced_search' ? result.results : result)[collection].length).toBeGreaterThan(0);
});

it.each([
  [{ activity_type: 'IC50' }, { activity_type: 'Ki' }],
  [{ activity_type: 'IC50', min_value: 100 }, { activity_type: 'IC50', min_value: 10000000 }],
  [{ activity_type: 'IC50', units: 'nM' }, { activity_type: 'IC50', units: 'ug.mL-1' }],
])('activity filters change counts: %j versus %j', async (left, right) => {
  const a = await invoke('search_by_activity_type', { ...left, limit: 2 });
  const b = await invoke('search_by_activity_type', { ...right, limit: 2 });
  for (const result of [a, b]) expect(result.activities.length).toBeGreaterThan(0);
  expect(a.page_meta.total_count).not.toBe(b.page_meta.total_count);
});
