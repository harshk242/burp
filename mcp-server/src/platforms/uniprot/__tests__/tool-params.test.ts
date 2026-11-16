import { afterEach, describe, expect, it } from 'vitest';
import { initClient, resetClient } from '../client.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants, samples, tools, handlers, rejectsEmpty, clientSide } from './tool-args.js';
import { assertUniProtRequest } from './request-contract.js';

const protein = {
  primaryAccession: 'P04637', uniProtkbId: 'P53_HUMAN',
  proteinDescription: { recommendedName: { fullName: { value: 'Cellular tumor antigen p53' } } },
  genes: [{ geneName: { value: 'TP53' } }], organism: { scientificName: 'Homo sapiens', taxonId: 9606 },
  sequence: { value: 'MEEPQ', length: 5, molWeight: 600 }, features: [{ type: 'Domain' }],
};
async function capture(name: string, args: Record<string, unknown>) {
  const recorder = requestRecorder(protein);
  initClient({}, { adapter: recorder.adapter });
  if (rejectsEmpty(name, args)) {
    await expect(handlers[name](args)).rejects.toThrow('requires at least one');
    expect(recorder.requests).toEqual([]);
  } else {
    await handlers[name](args);
    assertMakesRequest(recorder.requests);
    recorder.requests.forEach(assertUniProtRequest);
  }
  return recorder.requests;
}
afterEach(resetClient);
it('covers every registered handler', () => assertHandlerCoverage(tools, handlers));
describe.each(tools)('$name', tool => {
  it.each(argVariants(tool))('$label uses valid UniProt parameters and fields', async ({ args }) => { await capture(tool.name, args); });
  it('uses every argument and enum value', async () => {
    await assertArgsAffectRequests(tool, samples, args => capture(tool.name, args), tool.name === 'compare_proteins' ? clientSide : {});
  });
});
it('renders both comparison formats from populated protein data', async () => {
  await capture('compare_proteins', { accessions: samples.accessions });
  const json = await handlers.compare_proteins({ accessions: samples.accessions }) as any;
  expect(json.comparison).toHaveLength(2);
  expect(json.comparison[0]).toMatchObject({ accession: 'P04637', length: 5, domains: 1 });
  const tsv = await handlers.compare_proteins({ accessions: samples.accessions, format: 'tsv' });
  expect(tsv).toBe('accession\tname\torganism\tlength\tmass\tfeatures\tdomains\n' +
    Array(2).fill('P04637\tP53_HUMAN\tHomo sapiens\t5\t600\t1\t1').join('\n'));
});
it('rejects invalid search fields, return fields, routes, params and values', () => {
  const request = { method: 'get', url: 'https://rest.uniprot.org/uniprotkb/search', body: {}, params: { query: 'gene:TP53', format: 'json', size: 3 } };
  assertUniProtRequest({ ...request, params: { ...request.params, fields: 'accession,gene_names' } });
  for (const params of [
    { ...request.params, query: 'bogus_field:TP53' }, { ...request.params, fields: 'bogus_field' },
    { ...request.params, filter: 'human' }, { ...request.params, size: undefined },
    { ...request.params, query: '[object Object]' }, { ...request.params, query: null },
    { ...request.params, format: 'genbank' },
  ]) expect(() => assertUniProtRequest({ ...request, params })).toThrow();
  expect(() => assertUniProtRequest({ ...request, url: 'https://rest.uniprot.org/uniprotkb/unknown/route' })).toThrow();
  expect(() => assertUniProtRequest({ ...request, url: 'https://rest.uniprot.org/uniprotkb/P04637', params: request.params })).toThrow();
});
