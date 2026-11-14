import axios from 'axios';
import { afterAll, describe, expect, it } from 'vitest';
import { init, resetClient } from '../client.js';
import { tools, handlers } from '../tools/index.js';
import { pace, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { argVariants, samples } from './tool-args.js';
import { assertEnsemblRequest } from './request-contract.js';

const transport = axios.getAdapter('http');
afterAll(resetClient);
async function invoke(name: string, args: Record<string, unknown>): Promise<any> {
  let calls = 0;
  init({}, { adapter: async config => {
    await pace(200);
    const recorder = requestRecorder();
    await recorder.adapter(config);
    assertEnsemblRequest(recorder.requests[0]);
    calls++;
    // The production retry interceptor honours 429 Retry-After (including dates).
    return transport(config);
  } });
  const result: any = await handlers[name](args);
  expect(calls).toBeGreaterThanOrEqual(name === 'translate_sequence' ? 0 : 1);
  expect(result).toBeTruthy();
  if (name === 'batch_sequence_fetch') result.batch_results.forEach((row: any) => {
    expect(row.success, row.error).toBe(true);
    if (args.format !== 'json') expect(row.data).toMatch(/^>/);
  });
  if (['get_sequence', 'get_cds_sequence'].includes(name)) {
    if (args.format === 'json') expect(result.seq).toMatch(/^[ACGTNacgtn]+$/);
    else expect(result).toMatch(/^>/);
  }
  if (name === 'get_gene_tree' && args.format && args.format !== 'json') {
    expect(typeof result).toBe('string');
    expect(result).toMatch(args.format === 'newick' ? /;/ : /phyloxml/);
  }
  if (name === 'get_homologs' && args.format === 'xml') expect(result).toMatch(/<.*data/);
  if (name === 'search_genes') expect(result.result.biotype).toBe('protein_coding');
  if (name === 'get_variant_consequences') expect(result.map((r: any) => r.input)).toEqual(expect.arrayContaining(args.variants as string[]));
  if (name === 'map_coordinates') expect(result.mappings.length).toBeGreaterThan(0);
  if (['get_variants', 'get_regulatory_features', 'get_motif_features'].includes(name)) expect(result.length).toBeGreaterThan(0);
  return result;
}
describe.each(tools)('$name live handler', tool => {
  it.each(argVariants(tool))('$label returns real data', async ({ args }) => { await invoke(tool.name, args); });
});
it('SO terms and regulatory feature types narrow results', async () => {
  const args = { region: samples.region };
  const all = await invoke('get_variants', args);
  const filtered = await invoke('get_variants', { ...args, consequence_type: ['missense_variant'] });
  expect(filtered.length).toBeLessThan(all.length);
  const regulatoryArgs = { region: '17:7661779-7687550' };
  const regulatory = await invoke('get_regulatory_features', regulatoryArgs);
  const enhancers = await invoke('get_regulatory_features', { ...regulatoryArgs, feature_type: 'enhancer' });
  expect(enhancers.length).toBeLessThan(regulatory.length);
  enhancers.forEach((row: any) => expect(row.description).toBe('enhancer'));
});
it('motif region and local gene/transcript filters change the output', async () => {
  const broad = await invoke('get_motif_features', { region: '17:7661779-7687550' });
  const narrow = await invoke('get_motif_features', { region: '17:7673420-7673436' });
  expect(narrow.length).toBeLessThan(broad.length);
  narrow.forEach((row: any) => { expect(row.start).toBeLessThanOrEqual(7673436); expect(row.end).toBeGreaterThanOrEqual(7673420); });
  const all = await invoke('get_transcripts', { gene_id: samples.gene_id });
  const canonical = await invoke('get_transcripts', { gene_id: samples.gene_id, canonical_only: true });
  expect(canonical.transcripts.length).toBeLessThan(all.transcripts.length);
  canonical.transcripts.forEach((row: any) => expect(row.is_canonical).toBe(1));
  init({}, { adapter: async config => { await pace(200); return transport(config); } });
  expect((await handlers.search_genes({ query: 'TP53', biotype: 'lncRNA' }) as any).result).toBeNull();
});

it.each(['rs699', 'ENST00000269305.9:c.215C>G', '7 140753336 140753336 A/T 1'])('predicts VEP input %s live', async variant => {
  const result = await invoke('get_variant_consequences', { variants: [variant] });
  expect(result[0].transcript_consequences.length).toBeGreaterThan(0);
});
