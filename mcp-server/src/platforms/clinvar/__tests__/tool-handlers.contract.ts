import axios from 'axios';
import { afterAll, describe, expect, it } from 'vitest';
import { closeClient, createClinVarNcbiHttp, initializeClient } from '../client.js';
import { platform } from '../index.js';
import { assertNcbiFieldsMatch, paceNcbi } from '../../__test-utils__/ncbi.js';
import { argVariants } from './tool-args.js';
import { assertSearchAccepted, fields } from './request-contract.js';

const transport = axios.getAdapter(axios.defaults.adapter);
afterAll(closeClient);

async function invoke(name: string, args: Record<string, unknown>) {
  let requests = 0;
  initializeClient({ adapter: async config => {
    await paceNcbi(); // Pace every actual request, including summaries and retries.
    requests++;
    const response = await transport(config);
    if (config.url?.includes('esearch')) assertSearchAccepted(response.data, String(config.params.term), true);
    return response;
  } });
  try {
    const result = await platform.handlers[name](args);
    expect(requests).toBeGreaterThan(0);
    expect(result).toBeDefined();
    return result;
  } finally { closeClient(); }
}
const key = process.env.NCBI_API_KEY ? { api_key: process.env.NCBI_API_KEY } : {};
it('matches the saved NCBI einfo field list including additions', async () => {
  await paceNcbi();
  const response = await createClinVarNcbiHttp().get('einfo.fcgi', {
    params: { db: 'clinvar', retmode: 'json', ...key },
  });
  const live = response.data.einforesult.dbinfo[0].fieldlist.map(
    ({ name, fullname }: { name: string; fullname: string }) => ({ name, fullname }),
  );
  assertNcbiFieldsMatch(live, fields);
});
describe.each(platform.tools)('$name live handler', tool => {
  it.each(argVariants(tool))('$label is accepted without ignored fields or phrases', async ({ args }) => {
    const result = await invoke(tool.name, args);
    if (tool.name === 'search_by_molecular_consequence' || tool.name === 'lookup_by_coordinates') {
      expect((result as { count: number }).count).toBeGreaterThan(0);
    }
    if (tool.name === 'lookup_by_coordinates') expect(result).toMatchObject({ assembly: 'GRCh38' });
    if (['get_variant_info', 'get_vcv_record'].includes(tool.name)) expect(result).not.toBeNull();
  });
});
it('pathogenic properties narrow TP53 without matching All Fields text', async () => {
  const all = await invoke('search_variants_by_gene', { gene: 'TP53', max_results: 1 }) as { count: number };
  const pathogenic = await invoke('search_variants_by_gene', {
    gene: 'TP53', clinical_significance: 'pathogenic', max_results: 1,
  }) as { count: number };
  expect(pathogenic.count).toBeGreaterThan(0);
  expect(pathogenic.count).toBeLessThan(all.count);
  await paceNcbi();
  const response = await createClinVarNcbiHttp().get('esearch.fcgi', {
    params: { db: 'clinvar', retmode: 'json', retmax: 0, term: 'TP53[gene] AND pathogenic[All Fields]', ...key },
  });
  expect(pathogenic.count).toBeLessThan(Number(response.data.esearchresult.count));
});
