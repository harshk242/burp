import axios from 'axios';
import { afterAll, describe, expect, it } from 'vitest';
import { initializeClient, closeClient } from '../client.js';
import { platform } from '../index.js';
import { requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants, missingCriteria } from './tool-args.js';
import { assertClinPGxRequest, parameters } from './request-contract.js';
import { pacedTransport, turn } from './live-pacing.js';

afterAll(closeClient);
async function invoke(name: string, args: Record<string, unknown>): Promise<any> {
  let calls = 0;
  initializeClient({ adapter: async config => {
    const recorder = requestRecorder();
    await recorder.adapter(config);
    assertClinPGxRequest(recorder.requests[0]!);
    calls++;
    const response = await pacedTransport(config);
    expect(response.status).toBe(200);
    return response;
  } });
  if (missingCriteria(name, args)) {
    await expect(platform.handlers[name]!(args)).rejects.toThrow('Either gene or drug');
    expect(calls).toBe(0);
    return undefined;
  }
  const result: any = await platform.handlers[name]!(args);
  expect(calls).toBeGreaterThan(0);
  if (name === 'get_database_stats') {
    for (const key of ['genes', 'pathways', 'clinicalAnnotations', 'guidelines', 'labels']) {
      expect(result[key], key).toMatchObject({ status: 'available' });
      expect(result[key].count, key).toBeGreaterThan(0);
    }
  } else if (name === 'get_guidelines_for_pair') {
    expect(result.guidelines.length).toBeGreaterThan(0);
    expect(result.labels.length).toBeGreaterThan(0);
    [...result.guidelines, ...result.labels].forEach(row => expect(row.genes).toContain(args.gene));
  } else if (Array.isArray(result)) {
    expect(result.length).toBeGreaterThan(0);
    if (name === 'get_star_alleles') result.forEach(row => {
      expect(row.gene).toBe(args.gene);
      expect(row.name).toContain('*');
    });
    if (name === 'get_annotations_by_evidence') result.forEach(row => {
      const levels = ['1A', '1B', '2A', '2B', '3', '4'];
      const code = row.levelOfEvidence.match(/Level (1A|1B|2A|2B|3|4)\b/)?.[1];
      expect(levels.indexOf(code)).toBeGreaterThanOrEqual(0);
      expect(levels.indexOf(code)).toBeLessThanOrEqual(levels.indexOf(typeof args.minLevel === 'string' ? args.minLevel : '1A'));
    });
    if (name === 'get_dosing_guidelines') result.forEach(row => {
      if (args.source) expect(row.source).toBe(args.source);
      if (args.drug) expect(row.drugs.map((drug: string) => drug.toLowerCase())).toContain(args.drug);
    });
  } else {
    expect(result).toBeTruthy();
    if (result.results) {
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.length).toBeLessThanOrEqual(Number(args.maxResults ?? (name === 'list_cpic_genes' ? 100 : 20)));
    } else expect(result.id).toBeTruthy();
  }
  return result;
}
it('compares documented parameters with the current API spec', async () => {
  await turn();
  const spec = (await axios.get('https://api.clinpgx.org/openapi.json')).data;
  for (const [path, saved] of Object.entries(parameters)) expect(spec.paths[path].get.parameters, path).toEqual(saved);
});
describe.each(platform.tools)('$name live handler', tool => {
  it.each(argVariants(tool))('$label returns known data or explicit input validation', async ({ args }) => {
    await invoke(tool.name, args);
  });
});
it('relationship criteria are applied rather than silently ignored', async () => {
  const cases = [
    ['/data/pathway', 'genes.symbol'], ['/data/haplotype', 'gene.symbol'],
    ['/data/clinicalAnnotation', 'location.genes.symbol'], ['/data/clinicalAnnotation', 'location.fingerprint'], ['/data/clinicalAnnotation', 'relatedChemicals.name'],
    ['/data/guidelineAnnotation', 'relatedGenes.symbol'], ['/data/guidelineAnnotation', 'relatedChemicals.name'],
    ['/data/labelAnnotation', 'relatedGenes.symbol'], ['/data/labelAnnotation', 'relatedChemicals.name'],
  ] as const;
  for (const [path, key] of cases) {
    await turn();
    const response = await axios.get(`https://api.clinpgx.org/v1${path}`, {
      params: { [key]: 'NONEXISTENT_RECORD_123456789' }, validateStatus: () => true,
    });
    expect(response.status, `${path}: ${key}`).toBe(404);
    expect(response.data.data.errors).toEqual([{ message: 'No results matching criteria.' }]);
  }
});

it('rejects an unscoped pathway request before contacting upstream', async () => {
  await expect(platform.handlers.get_pathways!({})).rejects.toThrow('requires a nonblank gene');
});
