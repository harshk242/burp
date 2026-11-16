import { afterEach, describe, expect, it } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { initClient, resetClient } from '../client.js';
import { platform } from '../index.js';
import { SEARCH_FIELDS, UNREVIEWED_HINT, quoteQuery, searchSize, summarizeSearch } from '../search-fields.js';
import { tools } from '../tools/definitions.js';

const entry = {
  primaryAccession: 'P04637', uniProtkbId: 'P53_HUMAN',
  entryType: 'UniProtKB reviewed (Swiss-Prot)', annotationScore: 5,
  proteinDescription: { recommendedName: { fullName: { value: 'Cellular tumor antigen p53' } } },
  genes: [{ geneName: { value: 'TP53' }, synonyms: [{ value: 'P53' }, { value: 'TP53' }] }],
  organism: { scientificName: 'Homo sapiens', taxonId: 9606, lineage: ['unneeded'] },
  sequence: { length: 393, value: 'unneeded' },
  comments: [{ commentType: 'FUNCTION', texts: [{ value: 'x'.repeat(1000), evidences: ['unneeded'] }] }],
  references: ['unneeded'],
};

function mockSearch(text = '', options: { results?: unknown[]; headers?: Record<string, string>; source?: unknown } = {}) {
  const calls: InternalAxiosRequestConfig[] = [];
  initClient({}, { adapter: async config => {
    calls.push(config);
    const search = config.url === '/uniprotkb/search';
    return {
      data: search ? (text || { results: options.results ?? [entry] }) : (options.source ?? entry),
      status: 200, statusText: 'OK', headers: search ? (options.headers ?? {}) : {}, config,
    };
  } });
  return calls;
}
afterEach(resetClient);

const cases: [string, Record<string, unknown>, string][] = [
  ['search_proteins', { query: 'kinase OR insulin', organism: 'human' },
    'reviewed:true AND (kinase OR insulin) AND organism_id:9606'],
  ['search_by_gene', { gene: 'TP53' },
    'reviewed:true AND gene:"TP53" AND organism_name:"Homo sapiens"'],
  ['search_by_function', { goTerm: 'GO:0005524', function: 'ATP binding' },
    'reviewed:true AND go:"0005524" AND (cc_function:"ATP binding" OR ft_act_site:"ATP binding")'],
  ['search_by_localization', { localization: 'nucleus' },
    'reviewed:true AND cc_subcellular_location:"nucleus"'],
  ['search_by_taxonomy', { taxonomyId: 9606, taxonomyName: 'Mammalia' },
    'reviewed:true AND taxonomy_id:"9606" AND taxonomy_name:"Mammalia"'],
  ['advanced_search', { query: 'kinase OR insulin', minLength: 10, maxMass: 200, keywords: ['ATP'] },
    'reviewed:true AND (kinase OR insulin) AND length:[10 TO *] AND mass:[* TO 200] AND keyword:"ATP"'],
  ['get_protein_homologs', { accession: 'P04637', organism: 'mouse' },
    'reviewed:true AND protein_name:"Cellular tumor antigen p53" AND organism_id:10090 NOT accession:"P04637"'],
  ['get_protein_orthologs', { accession: 'P04637' },
    'reviewed:true AND gene:"TP53" NOT accession:"P04637"'],
];

describe('summary search requests', () => {
  it.each(cases)('%s uses summary fields, default size and reviewed scope', async (name, args, query) => {
    const calls = mockSearch();
    const result = await platform.handlers[name](args);
    expect(calls.at(-1)?.params).toEqual({ query, format: 'json', size: 10, fields: SEARCH_FIELDS });
    expect(result).toEqual(summarizeSearch({ results: [entry] }));
    const schema = tools.find(t => t.name === name)!.inputSchema.properties!;
    expect(schema.size).toMatchObject({ type: 'integer', maximum: 100, default: 10 });
    expect(schema.reviewed).toMatchObject({ type: 'boolean', default: true });
  });

  it.each(cases)('%s allows explicitly searching unreviewed entries', async (name, args) => {
    const calls = mockSearch();
    await platform.handlers[name]({ ...args, reviewed: false, size: 100 });
    expect(calls.at(-1)?.params.query).toMatch(/^reviewed:false AND /);
    expect(calls.at(-1)?.params.size).toBe(100);
  });

  it('escapes quoted literals, preserving raw advanced query syntax', async () => {
    const calls = mockSearch();
    const literal = 'a" OR gene:* \\ b';
    await platform.handlers.search_by_gene({ gene: literal, species: [literal, 'mouse'] });
    expect(calls[0].params.query).toBe(
      `reviewed:true AND gene:${quoteQuery(literal)} AND (organism_name:${quoteQuery(literal)} OR organism_id:10090)`,
    );
    expect(quoteQuery(literal)).toBe('"a\\" OR gene:* \\\\ b"');
  });

  it.each([0, 101, -1, 1.5, NaN, Infinity, '10', null])('rejects invalid size %s', value => {
    expect(() => searchSize(value)).toThrow('size must be an integer between 1 and 100');
  });
});

describe('summary projection', () => {
  it('keeps selection fields, deduplicates genes, bounds function text and discards evidence', () => {
    const result = summarizeSearch({ results: [entry] });
    expect(result.results[0]).toEqual({
      accession: 'P04637', entryId: 'P53_HUMAN', reviewed: true,
      proteinName: 'Cellular tumor antigen p53', geneNames: ['TP53', 'P53'],
      organism: 'Homo sapiens', taxonId: 9606, length: 393, annotationScore: 5,
      function: 'x'.repeat(299) + '…',
    });
    expect(JSON.stringify(result)).not.toContain('unneeded');
  });
  it('handles empty searches and sparse unreviewed entries', () => {
    expect(summarizeSearch({ results: [] })).toEqual({ results: [] });
    const unreviewed = summarizeSearch({ results: [{
      entryType: 'UniProtKB unreviewed (TrEMBL)',
      proteinDescription: { submissionNames: [{ fullName: { value: 'Submitted name' } }] },
    }] }).results[0];
    expect(unreviewed).toMatchObject({ reviewed: false, proteinName: 'Submitted name', geneNames: [] });
    expect(unreviewed.function).toBeUndefined();
  });
});

describe('non-JSON search formats', () => {
  it.each(['tsv', 'fasta'])('preserves %s output and bounds requests', async format => {
    const calls = mockSearch('raw output');
    expect(await platform.handlers.search_proteins({ query: 'TP53', size: 100, format })).toBe('raw output');
    expect(calls[0].params.size).toBe(format === 'fasta' ? 10 : 100);
    expect(calls[0].params.format).toBe(format);
    expect(calls[0].params.fields).toBe(format === 'fasta' ? undefined : SEARCH_FIELDS.replace(',cc_function', ''));
  });
  it('builds valid summary XML because UniProt XML ignores fields', async () => {
    const calls = mockSearch();
    const result = await platform.handlers.search_proteins({ query: 'TP53', format: 'xml' });
    expect(calls[0].params).toMatchObject({ format: 'json', fields: SEARCH_FIELDS });
    expect(new XMLParser().parse(result as string).search.results.entry.accession).toBe('P04637');
    expect(result).not.toContain('unneeded');
  });
});

describe('search result metadata', () => {
  it('returns the total hit count from X-Total-Results', async () => {
    mockSearch('', { headers: { 'x-total-results': '6682' } });
    expect(await platform.handlers.search_by_function({ goTerm: 'GO:0004672' })).toMatchObject({ totalResults: 6682 });
  });
  it('suggests unreviewed entries when a reviewed search is empty', async () => {
    mockSearch('', { results: [], headers: { 'x-total-results': '0' } });
    expect(await platform.handlers.search_by_gene({ gene: 'FOO123XYZ' })).toEqual({
      totalResults: 0, results: [], hint: UNREVIEWED_HINT,
    });
    expect(await platform.handlers.search_by_gene({ gene: 'FOO123XYZ', reviewed: false })).toEqual({ totalResults: 0, results: [] });
  });
  it('keeps totalResults and the hint in summary XML', async () => {
    mockSearch('', { results: [], headers: { 'x-total-results': '0' } });
    const xml = new XMLParser().parse(await platform.handlers.search_proteins({ query: 'none', format: 'xml' }) as string);
    expect(xml.search).toMatchObject({ totalResults: 0, hint: UNREVIEWED_HINT });
  });
});

describe('reviewed terms in user queries', () => {
  it.each([
    ['search_proteins', { query: 'gene:TP53 AND reviewed:false' }, '(gene:TP53 AND reviewed:false)'],
    ['search_proteins', { query: 'Reviewed : true', reviewed: false }, '(Reviewed : true)'],
    ['advanced_search', { query: '(reviewed:false) AND kinase', organism: '9606' }, '((reviewed:false) AND kinase) AND organism_id:9606'],
  ])('%s does not add a conflicting default filter', async (name, args, query) => {
    const calls = mockSearch();
    await platform.handlers[name](args);
    expect(calls[0].params.query).toBe(query);
  });
  it('does not treat other fields that end in "reviewed" as the reviewed filter', async () => {
    const calls = mockSearch();
    await platform.handlers.search_proteins({ query: 'unreviewed:x' });
    expect(calls[0].params.query).toBe('reviewed:true AND (unreviewed:x)');
  });
});

describe('organism filters', () => {
  it.each([
    ['9606', 'organism_id:9606'], [' Mouse ', 'organism_id:10090'], ['Homo sapiens', 'organism_id:9606'],
    ['Escherichia coli', 'organism_name:"Escherichia coli"'],
  ])('maps %j to %s', async (organism, filter) => {
    const calls = mockSearch();
    await platform.handlers.search_by_localization({ localization: 'nucleus', organism });
    await platform.handlers.search_by_function({ function: 'kinase', organism });
    await platform.handlers.get_protein_orthologs({ accession: 'P04637', organism });
    for (const call of calls.filter(c => c.url === '/uniprotkb/search')) expect(call.params.query).toContain(` AND ${filter}`);
  });
});

describe('homolog and ortholog guards', () => {
  it('matches TrEMBL submission names when there is no recommended name', async () => {
    const calls = mockSearch('', { source: { proteinDescription: { submissionNames: [{ fullName: { value: 'Cadherin-1' } }] } } });
    await platform.handlers.get_protein_homologs({ accession: 'A0A0U2ZQU7' });
    expect(calls[1].params.query).toBe('reviewed:true AND protein_name:"Cadherin-1" NOT accession:"A0A0U2ZQU7"');
  });
  it.each([
    ['get_protein_homologs', 'protein name'], ['get_protein_orthologs', 'primary gene name'],
  ])('%s returns an explained empty result instead of unrelated proteins', async (name, missing) => {
    const calls = mockSearch('', { source: { primaryAccession: 'A0A0U2ZQU7' } });
    const result: any = await platform.handlers[name]({ accession: 'A0A0U2ZQU7' });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ totalResults: 0, results: [] });
    expect(result.hint).toContain(missing);
  });
});
