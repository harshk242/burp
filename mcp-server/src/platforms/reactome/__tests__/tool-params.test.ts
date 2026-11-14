import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { initClient, resetClient } from '../client.js';
import { runWithToolCallContext } from "../../../shared/tool-call-context.js";
import { handlers, SEARCH_TYPES } from '../handlers.js';
import { tools } from '../tools.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants, samples } from './tool-args.js';
import { assertReactomeRequest } from './request-contract.js';

const molecule = { stId: 'R-HSA-4419969', displayName: 'Protein', schemaClass: 'EntityWithAccessionedSequence', speciesName: 'Homo sapiens' };
function response(url: string) {
  if (url.includes('/search/')) return { numberOfMatches: 1, results: [{ typeName: 'Protein', entries: [{ ...molecule, type: 'Protein' }] }] };
  if (url.includes('/interactors/')) return { entities: [{ acc: 'P04637', interactors: [{ acc: 'Q00987', alias: '<b>MDM2</b>' }, { acc: 'FOREIGN', alias: 'unrelated' }] }] };
  if (url.endsWith('/referenceEntities')) return ['P04637', 'Q00987'].map(identifier => ({ identifier, databaseName: 'UniProt', name: ['protein'] }));
  if (url.endsWith('/ancestors')) return [[{ stId: 'R-HSA-1', schemaClass: 'Pathway' }, molecule]];
  if (url.includes('/data/query/')) return { ...molecule, hasEvent: [] };
  return [molecule];
}
function setup(failAt = -1, failure: number | 'network' = 503) {
  const requests: ReturnType<typeof requestRecorder>['requests'] = [];
  const adapter: AxiosAdapter = async config => {
    const recorder = requestRecorder(response(config.url!));
    const result = await recorder.adapter(config);
    requests.push(...recorder.requests);
    if (requests.length === failAt) throw new AxiosError('upstream failure', failure === 'network' ? 'ERR_NETWORK' : 'ERR_BAD_RESPONSE', config, undefined,
      failure === 'network' ? undefined : { ...result, status: failure });
    return result;
  };
  initClient({}, { adapter });
  return requests;
}
async function capture(name: string, args: Record<string, unknown>) {
  const requests = setup();
  await handlers[name](args);
  assertMakesRequest(requests);
  requests.forEach(assertReactomeRequest);
  return requests;
}
afterEach(resetClient);
it('covers all registered tools', () => assertHandlerCoverage(tools, handlers));
describe.each(tools)('$name', tool => {
  it.each(argVariants(tool))('$label uses supported routes and parameters', async ({ args }) => { await capture(tool.name, args); });
  it('uses every argument', async () => {
    const reasons: Record<string, string> = tool.name === 'search_pathways' ? { type: 'Generic string mutation is outside the enum; every valid facet is checked separately.' } : {};
    await assertArgsAffectRequests(tool, samples, args => capture(tool.name, args), reasons);
    if (tool.name === 'search_pathways') {
      const requests = await Promise.all(SEARCH_TYPES.map(type => capture(tool.name, { ...samples, type })));
      expect(new Set(requests.map(r => JSON.stringify(r))).size).toBe(SEARCH_TYPES.length);
    }
  });
  it.each([404, 503, 'network'] as const)('propagates %s at every request stage', async failure => {
    const args = argVariants(tool)[0].args;
    const count = (await capture(tool.name, args)).length;
    for (let stage = 1; stage <= count; stage++) {
      setup(stage, failure);
      await expect(handlers[tool.name](args)).rejects.toThrow();
    }
  });
});
it('restricts real interactions to pathway accessions and strips markup', async () => {
  setup();
  expect(await handlers.get_protein_interactions({ pathwayId: samples.pathwayId })).toMatchObject({
    interactionCount: 1, interactions: [{ source: 'P04637', target: 'Q00987', name: 'MDM2' }],
  });
});
it('rejects routes and params upstream might silently ignore', () => {
  for (const [path, params] of [
    ['/data/pathway/R-HSA-4419969/participatingMolecules', {}],
    ['/search/query', { query: 'TP53', types: 'protein' }],
    ['/search/query', { query: 'TP53', bogus: true }],
  ] as const) expect(() => assertReactomeRequest({ method: 'get', url: 'https://reactome.org/ContentService' + path, params, body: {} })).toThrow();
});
it('reports a genuine empty search explicitly without inventing pathway participants', async () => {
  initClient({}, { adapter: requestRecorder({ numberOfMatches: 0, results: [] }).adapter });
  expect(await handlers.find_pathways_by_gene({ gene: 'unknown-gene' })).toMatchObject({
    message: 'No protein entity found for this gene and species', pathways: [],
  });
  await expect(handlers.get_pathway_participants({ id: 'unknown-pathway' })).rejects.toThrow('No pathway found');
});
it.each([true, false])('recognizes only an accession-specific not-found body (matching=%s)', async matching => {
  initClient({}, { adapter: async config => {
    if (config.url!.includes('/interactors/')) {
      const acc = config.data;
      const data = JSON.stringify({ code: 404, messages: matching
        ? String(acc).split(',').map(id => 'No interactors found for accession: ' + id) : ['Could not find the Interactor Resource'] });
      throw new AxiosError('not found', 'ERR_BAD_REQUEST', config, undefined,
        { data, status: 404, statusText: 'Not Found', headers: {}, config });
    }
    return requestRecorder(response(config.url!)).adapter(config);
  } });
  const result = handlers.get_protein_interactions({ pathwayId: samples.pathwayId });
  if (matching) expect(await result).toMatchObject({
    interactionCount: 0, noInteractorsFor: ['P04637', 'Q00987'],
  });
  else await expect(result).rejects.toThrow();
});
it('batches unique accessions and caps total work at 1000', async () => {
  const requests: any[] = [];
  initClient({}, { adapter: async config => {
    const data = config.url!.endsWith('/referenceEntities')
      ? Array.from({ length: 1200 }, (_, i) => ({ identifier: 'P' + i, databaseName: 'UniProt' }))
      : config.method === 'post' ? { entities: [] } : molecule;
    const recorder = requestRecorder(data);
    const result = await recorder.adapter(config);
    requests.push(...recorder.requests);
    return result;
  } });
  const result: any = await handlers.get_protein_interactions({ pathwayId: samples.pathwayId });
  const batches = requests.filter(r => r.method === 'post');
  expect(batches).toHaveLength(10);
  expect(batches.every(r => r.body.split(',').length === 100)).toBe(true);
  expect(result).toMatchObject({ queriedAccessions: 1000, truncated: true });
  expect(result.skippedAccessions).toHaveLength(200);
  expect(result.noInteractorsFor).toHaveLength(1000);
});
it('stops before interactor batches when the tool deadline expires', async () => {
  let now = 0;
  const requests: any[] = [];
  initClient({}, { adapter: async config => {
    const recorder = requestRecorder(response(config.url!));
    const result = await recorder.adapter(config);
    requests.push(...recorder.requests);
    if (config.url!.endsWith("/referenceEntities")) now = 1000;
    return result;
  } });
  const result: any = await runWithToolCallContext({ timeoutMs: 1000, now: () => now }, () =>
    handlers.get_protein_interactions({ pathwayId: samples.pathwayId }));
  expect(requests.filter(r => r.method === 'post')).toHaveLength(0);
  expect(result).toMatchObject({ queriedAccessions: 0, truncated: true, skippedAccessions: ['P04637', 'Q00987'] });
});
