import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeClient, closeClient } from '../client.js';
import { platform } from '../index.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants, missingCriteria, toolSamples } from './tool-args.js';
import { assertClinPGxRequest } from './request-contract.js';

// Multiple populated rows make client-side filtering observable.
const rows = ['CYP2D6', 'CYP2C19'].flatMap((gene, index) => ['CPIC', 'DPWG'].flatMap(source =>
  ['1A', '1B', '2A', '2B', '3', '4'].map(level => ({
    id: `PA${index + 1}${level.replace(/\D/g, '')}`, symbol: gene, name: `${source} *1 guideline`,
    gene: { symbol: gene }, rsid: 'rs3892097', location: { genes: [{ symbol: gene }], displayName: 'rs3892097' },
    relatedGenes: [{ symbol: gene }], relatedChemicals: [{ name: index ? 'clopidogrel' : 'codeine' }],
    levelOfEvidence: level, source: 'FDA',
  }))));
function setup(failAt = -1, failure: number | 'network' = 503) {
  const requests: ReturnType<typeof requestRecorder>['requests'] = [];
  const adapter: AxiosAdapter = async config => {
    const data = config.url?.includes("/variant") || config.url === "/data/haplotype" ? rows.map(({ location, ...row }) => row) : rows;
    const recorder = requestRecorder({ data });
    const result = await recorder.adapter(config);
    requests.push(...recorder.requests);
    if (requests.length === failAt) throw new AxiosError('upstream failure', 'ERR_BAD_RESPONSE', config, undefined,
      failure === 'network' ? undefined : { ...result, status: failure });
    return result;
  };
  initializeClient({ adapter, maxAttempts: 1 });
  return requests;
}
async function capture(name: string, args: Record<string, unknown>) {
  const requests = setup();
  await platform.handlers[name]!(args);
  assertMakesRequest(requests);
  requests.forEach(assertClinPGxRequest);
  return requests;
}
afterEach(closeClient);
it('covers all tools', () => assertHandlerCoverage(platform.tools, platform.handlers));
describe.each(platform.tools)('$name', tool => {
  it.each(argVariants(tool))('$label uses valid requests', async ({ args }) => {
    if (missingCriteria(tool.name, args)) {
      const requests = setup();
      await expect(platform.handlers[tool.name]!(args)).rejects.toThrow('Either gene or drug');
      expect(requests).toHaveLength(0);
    } else await capture(tool.name, args);
  });
  it('uses every argument', async () => {
    const reasons: Record<string, string> = {};
    if ('maxResults' in (tool.inputSchema.properties ?? {})) reasons.maxResults = 'Results are sliced locally; verified below.';
    if (tool.name === 'get_annotations_by_evidence') reasons.minLevel = 'Evidence threshold is filtered locally; verified below.';
    if (tool.name === 'get_dosing_guidelines') {
      reasons.drug = 'Drug is filtered locally when gene is present; verified below.';
      reasons.source = 'Guideline source is filtered locally; verified below.';
    }
    if (tool.name === 'get_guidelines_for_pair') reasons.gene = 'Both guidelines and labels are filtered locally by gene; verified below.';
    await assertArgsAffectRequests(tool, toolSamples(tool), args => capture(tool.name, args), reasons);
  });
  it.each([400, 404, 503, 'network'] as const)('preserves %s at each request stage', async failure => {
    const args = argVariants(tool)[0]!.args;
    const count = (await capture(tool.name, args)).length;
    for (let stage = 1; stage <= count; stage++) {
      setup(stage, failure);
      if (tool.name === 'get_database_stats') {
        const result = await platform.handlers[tool.name]!(args) as Record<string, any>;
        expect(Object.values(result).filter(value => value.status === 'failed')).toHaveLength(1);
        expect(Object.values(result).find(value => value.status === 'failed')).not.toHaveProperty('count');
      } else await expect(platform.handlers[tool.name]!(args)).rejects.toThrow();
    }
  });
});
it('applies every local result limit', async () => {
  for (const name of ['list_cpic_genes', 'search_genes', 'search_drugs', 'search_variants']) {
    for (const maxResults of [1, 3]) {
      setup();
      const result = await platform.handlers[name]!({ query: 'sample', maxResults }) as any;
      expect(result.results).toHaveLength(maxResults);
    }
  }
});
it('queries star allele haplotypes by gene without truncating to 100', async () => {
  const recorder = requestRecorder({ data: Array.from({ length: 177 }, (_, index) => ({
    id: `PA${index}`, name: `*${index}`, gene: { symbol: 'CYP2D6' },
  })) });
  initializeClient({ adapter: recorder.adapter });
  expect(await platform.handlers.get_star_alleles!({ gene: 'CYP2D6' })).toHaveLength(177);
  expect(recorder.requests).toEqual([{
    method: 'get', url: 'https://api.clinpgx.org/v1/data/haplotype',
    params: { 'gene.symbol': 'CYP2D6' }, body: {},
  }]);
});
it('queries annotations by the resolved fingerprint even without a variant gene', async () => {
  const requests: ReturnType<typeof requestRecorder>['requests'] = [];
  initializeClient({ adapter: async config => {
    const recorder = requestRecorder({ data: config.url === '/data/variant'
      ? [{ id: 'PA166156104', name: 'rs3892097' }] : rows });
    const result = await recorder.adapter(config);
    requests.push(...recorder.requests);
    return result;
  } });
  expect((await platform.handlers.get_variant_annotations!({ variantId: 'rs3892097' }) as unknown[]).length).toBeGreaterThan(0);
  expect(requests[1]).toMatchObject({
    url: 'https://api.clinpgx.org/v1/data/clinicalAnnotation', params: { 'location.fingerprint': 'rs3892097' },
  });
});
it('applies every evidence threshold', async () => {
  for (const [index, minLevel] of ['1A', '1B', '2A', '2B', '3', '4'].entries()) {
    setup();
    const result = await platform.handlers.get_annotations_by_evidence!({ gene: 'CYP2D6', minLevel }) as any[];
    expect(result).toHaveLength((index + 1) * 4);
  }
});
it('applies source with either gene or drug, and both drug and gene together', async () => {
  for (const source of ['CPIC', 'DPWG']) {
    for (const args of [{ gene: 'CYP2D6' }, { drug: 'codeine' }, { gene: 'CYP2D6', drug: 'codeine' }]) {
      setup();
      const result = await platform.handlers.get_dosing_guidelines!({ ...args, source }) as any[];
      expect(result.length).toBeGreaterThan(0);
      result.forEach(row => {
        expect(row.source).toBe(source);
        if (args.drug) expect(row.drugs).toContain(args.drug);
      });
    }
  }
});
it('filters both guidelines and labels for a pair', async () => {
  for (const gene of ['CYP2D6', 'CYP2C19', 'unknown']) {
    setup();
    const result = await platform.handlers.get_guidelines_for_pair!({ drug: 'codeine', gene }) as any;
    expect(result.guidelines).toHaveLength(gene === 'unknown' ? 0 : 12);
    expect(result.labels).toHaveLength(gene === 'unknown' ? 0 : 12);
    [...result.guidelines, ...result.labels].forEach(row => expect(row.genes).toContain(gene));
  }
});
it('rejects invalid routes, path IDs and parameters', () => {
  const cases: [string, Record<string, unknown>][] = [['/data/typo', {}], ['/data/gene/bad-id', {}], ['/data/pathway', { cpicGene: true }], ['/data/variant', { bogus: true }]];
  for (const [path, params] of cases) {
    expect(() => assertClinPGxRequest({ method: 'get', url: `https://api.clinpgx.org/v1${path}`, params, body: {} })).toThrow();
  }
});

it.each([{}, { query: '' }, { query: '   ' }])('requires a gene for pathways: %j', async args => {
  await expect(platform.handlers.get_pathways!(args)).rejects.toThrow('requires a nonblank gene');
});
