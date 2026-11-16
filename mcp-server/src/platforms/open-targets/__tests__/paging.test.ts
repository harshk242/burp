import { AxiosError } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { closeClient, initializeClient } from '../client.js';
import { toolHandlers as handlers } from '../tools.js';
import { requestRecorder } from '../../__test-utils__/tool-requests.js';

afterEach(closeClient);
const rows = ['a', 'b', 'c', 'd'];
describe('client-side paging for upstream lists', () => {
  it.each([
    ['get_target_pathways_and_go_terms', 'target', 'pathways'],
    ['get_target_mouse_phenotypes', 'target', 'mousePhenotypes'],
    ['get_target_known_drugs', 'target', 'drugAndClinicalCandidates'],
    ['get_variant_pharmacogenomics', 'variant', 'pharmacogenomics'],
  ])('%s returns the selected page and preserves cached source data', async (name, root, field) => {
    const nested = field === 'drugAndClinicalCandidates';
    const recorder = requestRecorder({ data: { [root]: { [field]: nested ? { count: 4, rows } : rows } } });
    initializeClient({ adapter: recorder.adapter });
    const read = async (index: number, size: number) => {
      const result = await handlers[name]!({ ensembl_id: 'ENSG00000141510', variant_id: '19_44908684_T_C', page_index: index, page_size: size }) as Record<string, Record<string, unknown>>;
      const list = result[root]![field];
      return nested ? (list as { rows: string[] }).rows : list;
    };
    expect(await read(1, 2)).toEqual(['c', 'd']);
    expect(await read(0, 1)).toEqual(['a']);
    expect(await read(0, 4)).toEqual(rows);
    expect(recorder.requests).toHaveLength(1);
  });
});
it('identifies schema failures without blaming tool arguments', async () => {
  initializeClient({ adapter: async (config) => {
    throw new AxiosError('Bad Request', 'ERR_BAD_REQUEST', config, undefined, {
      config, status: 400, statusText: 'Bad Request', headers: {},
      data: { errors: [{ message: 'Cannot query field "removed" on type "Target".' }] },
    });
  } });
  await expect(handlers.get_target_info!({ ensembl_id: 'ENSG00000141510' })).rejects.toThrow('integration must be updated');
});

it('limits literature locally without modifying cached rows', async () => {
  initializeClient({ adapter: requestRecorder({ data: { target: { literatureOcurrences: { rows, count: 4 } } } }).adapter });
  const read = async (size: number) => (await handlers.get_target_literature_occurrences!({ ensembl_id: 'ENSG00000141510', size }) as { target: { literatureOcurrences: { rows: string[] } } }).target.literatureOcurrences.rows;
  expect(await read(2)).toEqual(['a', 'b']);
  expect(await read(4)).toEqual(rows);
});
it('limits fuzzy suggestions locally', async () => {
  initializeClient({ adapter: requestRecorder({ data: { search: { hits: [
    { id: '1', name: 'BRCA1', entity: 'target' }, { id: '2', name: 'BRCA2', entity: 'target' },
  ] } } }).adapter });
  const read = async (max_suggestions: number) => (await handlers.search_suggestions!({ query_prefix: 'BRCA', max_suggestions }) as { suggestions: unknown[] }).suggestions;
  expect(await read(1)).toHaveLength(1);
  expect(await read(2)).toHaveLength(2);
});
it('does not expand nested studies for an empty unfiltered collection', async () => {
  const recorder = requestRecorder({ data: { credibleSets: { count: 0 } } });
  initializeClient({ adapter: recorder.adapter });
  await expect(handlers.get_credible_sets!({})).resolves.toEqual({ credibleSets: { count: 0, rows: [] } });
  expect(recorder.requests).toHaveLength(1);
  expect((recorder.requests[0]!.body as { query: string }).query).not.toMatch(/study\s*\{/);
});
it('keeps the complete selection for nonempty unfiltered collections', async () => {
  const complete = { credibleSets: { count: 1, rows: [{ studyLocusId: 'locus', study: { id: 'study' } }] } };
  let requests = 0;
  initializeClient({ adapter: async (config) => {
    const query = JSON.parse(config.data).query as string;
    requests++;
    return { config, status: 200, statusText: 'OK', headers: {}, data: {
      data: query.includes('CredibleSetsCount') ? { credibleSets: { count: 1 } } : complete,
    } };
  } });
  await expect(handlers.get_credible_sets!({})).resolves.toEqual(complete);
  expect(requests).toBe(2);
});
