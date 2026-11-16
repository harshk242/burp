import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { afterAll, describe, expect, it } from 'vitest';
import { createUniProtClient, initClient, resetClient } from '../client.js';
import { pace, requestRecorder } from '../../__test-utils__/tool-requests.js';
import queryFields from '../../__test-utils__/fixtures/uniprot/query-fields.json' with { type: "json" };
import returnFields from '../../__test-utils__/fixtures/uniprot/return-fields.json' with { type: "json" };
import { argVariants, tools, handlers, samples, rejectsEmpty } from './tool-args.js';
import { assertUniProtRequest, configureFields } from './request-contract.js';

const transport = axios.getAdapter('http');
// Serialize starts even for batch lookup's parallel requests; max two requests/sec.
let nextStart = Promise.resolve();
async function pacedTransport(config: Parameters<typeof transport>[0]) {
  nextStart = nextStart.then(() => pace(500));
  await nextStart;
  return transport(config);
}
afterAll(resetClient);
async function invoke(name: string, args: Record<string, unknown>): Promise<{ result: any; total?: number | undefined }> {
  let calls = 0;
  let total: number | undefined;
  initClient({}, { adapter: async config => {
    const recorder = requestRecorder();
    await recorder.adapter(config);
    assertUniProtRequest(recorder.requests[0]!);
    calls++;
    const response = await pacedTransport(config);
    if (config.url === '/uniprotkb/search') total = Number(response.headers['x-total-results']);
    return response;
  } });
  if (rejectsEmpty(name, args)) {
    await expect(handlers[name]!(args)).rejects.toThrow('requires at least one');
    expect(calls).toBe(0);
    return { result: undefined };
  }
  const result: any = await handlers[name]!(args);
  expect(calls).toBeGreaterThan(0);
  expect(result).toBeTruthy();
  if ((name.startsWith('search_') || ['advanced_search', 'get_protein_homologs', 'get_protein_orthologs'].includes(name))
    && (!args.format || args.format === 'json')) expect(Array.isArray(result.results)).toBe(true);
  if (result.results) {
    // Searches return compact summaries (default size 10), reviewed unless reviewed: false.
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.length).toBeLessThanOrEqual(Number(args.size ?? 10));
    result.results.forEach((row: any) => {
      expect(row.accession).toBeTruthy();
      expect(row.reviewed).toBe(args.reviewed !== false);
    });
    expect(total).toBeGreaterThan(0);
    expect(result.totalResults).toBe(total);
  }
  if (name === 'batch_protein_lookup') {
    const accessions = args.accessions as string[];
    if (args.format === 'fasta') expect(result.match(/^>/gm)).toHaveLength(accessions.length);
    else if (args.format === 'tsv') {
      const [header, ...rows] = result.trim().split('\n');
      expect(header).toMatch(/^Entry\t/);
      expect(rows.map((row: string) => row.split('\t')[0]).sort()).toEqual([...accessions].sort());
    } else {
      expect(result.batchResults).toHaveLength(accessions.length);
      result.batchResults.forEach((row: any) => {
        expect(row.success, row.error).toBe(true);
        expect(row.data.accession).toBe(row.accession);
      });
    }
  }
  if (name === 'compare_proteins') {
    if (args.format === 'tsv') {
      expect(result).toMatch(/^accession\tname\t/);
      expect(result.split('\n').slice(1).map((line: string) => line.split('\t')[0])).toEqual(args.accessions);
    } else expect(result.comparison.map((row: any) => row.accession)).toEqual(args.accessions);
  }
  if (name === 'export_protein_data') {
    expect(result).toMatch({ gff: /^##gff-version/, txt: /^ID\s/, xml: /^<\?xml/, fasta: /^>/ }[args.format as string]!);
  }
  if (['search_proteins', 'get_protein_info', 'get_protein_sequence'].includes(name)) {
    const format = args.format ?? (name === 'get_protein_sequence' ? 'fasta' : 'json');
    if (format === 'xml') {
      // UniProt ignores fields= for XML, so these render XML locally from projected JSON.
      const xml = new XMLParser().parse(result);
      if (name === 'search_proteins') {
        expect(xml.search.totalResults).toBe(total);
        expect([xml.search.results.entry].flat().every((row: any) => row.accession)).toBe(true);
      } else expect(xml.protein.primaryAccession).toBe(args.accession);
    } else if (format !== 'json') expect(result).toMatch(format === 'fasta' ? /^>/ : /^Entry\t/);
    else if (name === 'get_protein_sequence') expect(result.accession).toBe(args.accession);
    else if (name !== 'search_proteins') expect(result.primaryAccession).toBe(args.accession);
  }
  if (name === 'validate_accession') expect(result).toMatchObject({ isValid: true, exists: true });
  return { result, total };
}
describe.each(tools)('$name live handler', tool => {
  it.each(argVariants(tool))('$label returns real data or validates the empty query', async ({ args }) => { await invoke(tool.name, args); });
});
it.each([
  ['query', queryFields, 'search-fields'], ['return', returnFields, 'result-fields'],
] as const)('saved %s field identifiers match live configure', async (kind, saved, endpoint) => {
  const http = createUniProtClient({ adapter: pacedTransport });
  const response = await http.get(`/configure/uniprotkb/${endpoint}`);
  expect(configureFields(response.data, kind)).toEqual(saved);
});
it('species, taxonomy and search filters narrow the live result set', async () => {
  const http = createUniProtClient({ adapter: pacedTransport });
  const broad = await invoke('advanced_search', {});
  for (const [name, args] of [
    ['search_by_function', { goTerm: samples.goTerm }],
    ['search_by_function', { function: samples.function }],
    ['search_by_localization', { localization: samples.localization }],
    ['search_by_taxonomy', { taxonomyId: samples.taxonomyId }],
    ['search_by_taxonomy', { taxonomyName: samples.taxonomyName }],
    ...['query', 'organism', 'minLength', 'maxLength', 'minMass', 'maxMass', 'keywords'].map(key => ['advanced_search', { [key]: samples[key] }]),
  ] as Array<[string, Record<string, unknown>]>) {
    const filtered = await invoke(name, args);
    expect(filtered.total, `${name} ${JSON.stringify(args)}`).toBeLessThan(broad.total!);
    if (name !== 'advanced_search') continue;
    // Summaries omit mass and keywords; read them back for the returned accessions.
    const response = await http.get('/uniprotkb/accessions', { params: {
      accessions: filtered.result.results.map((row: any) => row.accession).join(','),
      format: 'json', fields: 'accession,length,mass,organism_id,keyword',
    } });
    expect(response.data.results).toHaveLength(filtered.result.results.length);
    response.data.results.forEach((row: any) => {
      if (args.minLength) expect(row.sequence.length).toBeGreaterThanOrEqual(Number(args.minLength));
      if (args.maxLength) expect(row.sequence.length).toBeLessThanOrEqual(Number(args.maxLength));
      if (args.minMass) expect(row.sequence.molWeight).toBeGreaterThanOrEqual(Number(args.minMass));
      if (args.maxMass) expect(row.sequence.molWeight).toBeLessThanOrEqual(Number(args.maxMass));
      if (args.organism) expect(row.organism.taxonId).toBe(9606);
      if (args.keywords) expect(row.keywords.map((keyword: any) => keyword.name)).toContain('Kinase');
    });
  }
  const proteins = await invoke('search_proteins', { query: 'kinase' });
  const human = await invoke('search_proteins', { query: 'kinase', organism: samples.organism });
  expect(human.total).toBeLessThan(proteins.total!);
  human.result.results.forEach((row: any) => expect(row.taxonId).toBe(9606));
  for (const [species, taxon] of [['human', 9606], ['mouse', 10090]] as const) {
    const gene = await invoke('search_by_gene', { gene: 'TP53', species: [species] });
    gene.result.results.forEach((row: any) => expect(row.taxonId).toBe(taxon));
  }
  for (const name of ['get_protein_homologs', 'get_protein_orthologs']) {
    const all = await invoke(name, { accession: samples.accession });
    const mouse = await invoke(name, { accession: samples.accession, organism: 'Mus musculus' });
    expect(mouse.total).toBeLessThan(all.total!);
    mouse.result.results.forEach((row: any) => {
      expect(row.taxonId).toBe(10090);
      expect(row.accession).not.toBe(samples.accession);
    });
  }
});
it('legacy localization field matches configured term/note fields', async () => {
  const alias = await invoke('search_by_localization', { localization: 'nucleus' });
  const canonical = await invoke('search_proteins', {
    query: 'reviewed:true AND (cc_scl_term:"nucleus" OR cc_scl_note:"nucleus")',
  });
  expect(alias.total).toBe(canonical.total);
  // Equivalent sets can have different default relevance ordering. Check their
  // symmetric difference rather than comparing the first page's rank order.
  const http = createUniProtClient({ adapter: pacedTransport });
  const a = 'cc_subcellular_location:"nucleus"';
  const b = '(cc_scl_term:"nucleus" OR cc_scl_note:"nucleus")';
  for (const query of [`reviewed:true AND ${a} NOT ${b}`, `reviewed:true AND ${b} NOT ${a}`]) {
    const response = await http.get('/uniprotkb/search', { params: { query, format: 'json', size: 1 } });
    expect(Number(response.headers['x-total-results'])).toBe(0);
    expect(response.data.results).toEqual([]);
  }
});
