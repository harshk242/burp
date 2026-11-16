import { afterEach, describe, expect, it } from 'vitest';
import { init, resetClient } from '../client.js';
import { tools, handlers } from '../tools/index.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants, samples, toolSamples, clientSide } from './tool-args.js';
import { assertEnsemblRequest } from './request-contract.js';
const gene = { id: samples.gene_id, biotype: 'protein_coding', Transcript: [{ id: 'canonical', is_canonical: 1 }, { id: 'other', is_canonical: 0 }] };
function setup(data: unknown = gene) {
  const recorder = requestRecorder(data);
  init({}, { adapter: recorder.adapter });
  return recorder.requests;
}
async function capture(name: string, args: Record<string, unknown>) {
  const requests = setup(['get_variant_consequences', 'get_variants', 'get_regulatory_features'].includes(name)
    ? [{ id: 'v1', description: 'enhancer' }, { id: 'v2', description: 'promoter' }] : gene);
  await handlers[name](args);
  assertMakesRequest(requests, name === 'translate_sequence' ? 'Local standard genetic code translation.' : undefined);
  requests.forEach(assertEnsemblRequest);
  return requests;
}
afterEach(resetClient);
it('covers all tools', () => assertHandlerCoverage(tools, handlers));
describe.each(tools)('$name', tool => {
  it.each(argVariants(tool))('$label uses documented parameters', async ({ args }) => { await capture(tool.name, args); });
  it('uses every argument and enum value', async () => {
    await assertArgsAffectRequests(tool, toolSamples(tool), args => capture(tool.name, args), clientSide[tool.name]);
  });
});
it('filters canonical transcripts and biotypes locally', async () => {
  setup(); expect((await handlers.get_transcripts({ gene_id: samples.gene_id }) as any).transcripts).toHaveLength(2);
  setup(); expect((await handlers.get_transcripts({ gene_id: samples.gene_id, canonical_only: true }) as any).transcripts).toEqual([gene.Transcript[0]]);
  for (const biotype of ['protein_coding', 'lncRNA']) {
    setup(); expect((await handlers.search_genes({ query: 'TP53', biotype }) as any).result).toEqual(biotype === gene.biotype ? gene : null);
  }
});
it('filters regulatory descriptions case insensitively', async () => {
  const rows = [{ description: 'enhancer' }, { description: 'promoter' }];
  setup(rows); expect(await handlers.get_regulatory_features({ region: samples.region })).toEqual(rows);
  setup(rows); expect(await handlers.get_regulatory_features({ region: samples.region, feature_type: 'ENHANCER' })).toEqual([rows[0]]);
});
it('unions and deduplicates multiple consequence term requests', async () => {
  const requests = setup([{ id: 'rs1', start: 1, end: 1 }]);
  expect(await handlers.get_variants({ region: samples.region, consequence_type: ['missense_variant', 'stop_gained'] })).toHaveLength(1);
  expect(requests.map(r => (r.params as any).so_term)).toEqual(['missense_variant', 'stop_gained']);
});
it('translates locally using the standard code', async () => {
  expect(await handlers.translate_sequence({ sequence: 'ATGTTTTAA' })).toMatchObject({ protein_sequence: 'MF*', genetic_code: 1 });
  expect(await handlers.translate_sequence({ sequence: 'ATGGGGTAA' })).toMatchObject({ protein_sequence: 'MG*' });
});
it('rejects unknown routes, parameters and missing path segments', () => {
  const cases: [string, Record<string, unknown>][] = [['/map/coords/human/GRCh37/1:1-2', {}], ['/overlap/region/human/1:1-2', { consequence_type: 'missense_variant' }], ['/sequence/region/human/', {}]];
  for (const [path, params] of cases) {
    expect(() => assertEnsemblRequest({ method: 'get', url: `https://rest.ensembl.org${path}`, params, body: {} })).toThrow();
  }
});

it.each([['rs699', 'id', 'ids'], ['ENST00000269305.9:c.215C>G', 'hgvs', 'hgvs_notations'], ['7 140753336 140753336 A/T 1', 'region', 'variants']])('routes VEP %s', async (variant, endpoint, key) => {
  const requests = setup([]);
  await handlers.get_variant_consequences({ variants: [variant] });
  expect(requests[0].url).toContain('/vep/homo_sapiens/' + endpoint);
  expect(requests[0].body).toEqual({ [key]: [variant] });
  requests.forEach(assertEnsemblRequest);
});
it.each([true, false])('sends multiple_sequences=%s for IDs', async multiple_sequences => {
  const requests = setup();
  await handlers.get_sequence({ region: samples.transcript_id, multiple_sequences });
  expect(requests[0].params).toMatchObject({ multiple_sequences: multiple_sequences ? 1 : 0 });
  requests.forEach(assertEnsemblRequest);
});
it('rejects multiple_sequences on genomic regions', async () => {
  await expect(handlers.get_sequence({ region: samples.region, multiple_sequences: true })).rejects.toThrow('ID-based');
});
it.each([
  ['/sequence/id/ENST00000269305', { mask: 'bogus' }],
  ['/sequence/id/ENST00000269305', { multiple_sequences: 'yes' }],
  ['/sequence/id/ENST00000269305', { type: 'bogus' }],
  ['/lookup/id/ENSG00000141510', { expand: 2 }],
  ['/overlap/region/human/1:1-2', { feature: 'bogus' }],
])('rejects invalid outgoing values on %s', (path, params) => {
  expect(() => assertEnsemblRequest({ method: 'get', url: 'https://rest.ensembl.org' + path, params, body: {} })).toThrow();
});
it.each(['/lookup/id', '/vep/human/id', '/vep/human/hgvs', '/vep/human/region'])('requires nonempty body arrays on %s', path => {
  for (const body of [{}, { ids: [] }, { ids: 'rs699' }]) {
    expect(() => assertEnsemblRequest({ method: 'post', url: 'https://rest.ensembl.org' + path, params: {}, body })).toThrow();
  }
});
