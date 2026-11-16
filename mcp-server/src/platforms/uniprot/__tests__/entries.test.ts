import { afterEach, describe, expect, it } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { initClient, resetClient } from '../client.js';
import { proteinHandlers as handlers } from '../tools/protein-handlers.js';
import { ENTRY_FIELDS, INFO_FIELDS } from '../entry-fields.js';

const evidence = { evidenceCode: 'ECO:0000269', source: 'PubMed', id: '123' };
const entry = {
  primaryAccession: 'P04637', uniProtkbId: 'P53_HUMAN',
  entryType: 'UniProtKB reviewed (Swiss-Prot)', annotationScore: 5,
  proteinExistence: 'Evidence at protein level',
  organism: { scientificName: 'Homo sapiens', taxonId: 9606, lineage: ['Eukaryota'] },
  extraAttributes: { countByFeatureType: { Domain: 2, Helix: 3, "Natural variant": 5 } },
  sequence: { length: 3, molWeight: 300, value: 'AKD', crc64: 'checksum', md5: 'md5' },
  comments: [{ commentType: 'DISEASE', disease: { acronym: 'LFS', evidences: [evidence] } },
    { commentType: 'DISEASE', disease: { acronym: 'BROVCA1' } },
    { commentType: 'DISEASE', disease: { acronym: 'A+B' } }],
  features: [
    { type: 'Natural variant', description: 'in LFS; dbSNP:rs123', evidences: [evidence, evidence] },
    { type: 'Natural variant', description: 'in BROVCA1', evidences: [evidence] },
    { type: 'Natural variant', description: 'in BROVCA12; uncertain significance' },
    { type: 'Natural variant', description: 'in a sporadic cancer' },
    { type: 'Natural variant', description: 'in A+B' },
    { type: 'Mutagenesis', description: 'in LFS' },
    { type: 'Helix' }, { type: 'Beta strand' }, { type: 'Turn' },
  ],
  references: [{ citation: { citationCrossReferences: [{ database: 'PubMed', id: '123' }] } }],
  uniProtKBCrossReferences: [{ database: 'PDB', id: '1ABC', properties: [{ key: 'Method', value: 'X-ray' }] },
    { database: 'GO', id: 'GO:123' }],
};
function mock(data: unknown = entry) {
  const calls: InternalAxiosRequestConfig[] = [];
  initClient({}, { adapter: async config => {
    calls.push(config);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  } });
  return calls;
}
afterEach(resetClient);

// Exhaustive tools fetch the full entry (undefined) so a retired UniProt return
// field cannot break them; the rest request short verified field lists.
const fields: [string, string | undefined][] = [
  ['get_protein_features', undefined],
  ['get_protein_structure', ENTRY_FIELDS.structure],
  ['get_protein_domains_detailed', ENTRY_FIELDS.domains],
  ['get_protein_variants', ENTRY_FIELDS.variants],
  ['analyze_sequence_composition', ENTRY_FIELDS.composition],
  ['get_protein_pathways', ENTRY_FIELDS.pathways],
  ['get_protein_interactions', ENTRY_FIELDS.interactions],
  ['compare_proteins', ENTRY_FIELDS.compare],
  ['get_phylogenetic_info', ENTRY_FIELDS.taxonomy],
  ['get_external_references', undefined],
  ['get_literature_references', ENTRY_FIELDS.literature],
  ['get_annotation_confidence', undefined],
  ['validate_accession', ENTRY_FIELDS.validate],
  ['get_taxonomy_info', ENTRY_FIELDS.taxonomy],
];
describe('entry field selection', () => {
  it.each(fields)('%s requests %s', async (tool, fields) => {
    const calls = mock();
    await handlers[tool]({ accession: 'P04637', accessions: ['P04637', 'P38398'] });
    expect(calls.length).toBe(tool === 'compare_proteins' ? 2 : 1);
    for (const call of calls) expect(call.params).toEqual(fields ? { format: 'json', fields } : { format: 'json' });
  });
  it('returns every comment type, including web resources, from the full entry', async () => {
    mock({ ...entry, comments: [...entry.comments, { commentType: 'WEB RESOURCE', resourceName: 'Atlas' }] });
    const result: any = await handlers.get_protein_features({ accession: 'P04637' });
    expect(result.comments.map((c: any) => c.commentType)).toContain('WEB RESOURCE');
    expect(result).not.toHaveProperty('references');
    expect(JSON.stringify(result)).not.toContain('evidences');
  });
  it('keeps all real secondary structure types', async () => {
    mock();
    const result: any = await handlers.get_protein_structure({ accession: 'P04637' });
    expect(result.structuralFeatures.map((f: any) => f.type)).toEqual(['Helix', 'Beta strand', 'Turn']);
  });
  it('compares feature totals using server counts rather than feature arrays', async () => {
    mock();
    const result: any = await handlers.compare_proteins({ accessions: ['P04637', 'P38398'] });
    expect(result.comparison[0]).toMatchObject({ features: 10, domains: 2, length: 3, mass: 300 });
    mock({});
    expect(await handlers.compare_proteins({ accessions: ['X', 'Y'] })).toMatchObject({
      comparison: [{ features: 0, domains: 0 }, { features: 0, domains: 0 }],
    });
  });
  it('counts feature ECO annotations without returning individual evidence objects', async () => {
    mock();
    expect(await handlers.get_annotation_confidence({ accession: 'P04637' })).toMatchObject({
      evidenceCodes: { 'ECO:0000269': 3 }, referenceCount: 1, reviewStatus: 'Reviewed',
    });
  });
  it('groups external references once and reads PubMed links from citations', async () => {
    mock();
    expect(await handlers.get_external_references({ accession: 'P04637' })).toEqual({
      accession: 'P04637', referenceCount: 2,
      referencesByDatabase: {
        PDB: { count: 1, references: [entry.uniProtKBCrossReferences[0]] },
        GO: { count: 1, references: [{ database: 'GO', id: 'GO:123' }] },
      },
    });
    expect(await handlers.get_literature_references({ accession: 'P04637' })).toMatchObject({
      pubmedReferences: [{ database: 'PubMed', id: '123' }], citationCount: 1,
    });
  });
});

describe('info and sequence formats', () => {
  it('slims info recursively without mutating the fetched entry', async () => {
    const calls = mock();
    const result: any = await handlers.get_protein_info({ accession: 'P04637' });
    expect(calls[0].params.fields).toBe(INFO_FIELDS);
    expect(result.references).toBeUndefined();
    expect(result.sequence.value).toBeUndefined();
    expect(result.detailTools).toMatchObject({ literature: 'get_literature_references', sequence: 'get_protein_sequence' });
    expect(result.pdbStructures).toEqual({ count: 1, ids: ['1ABC'], detailTool: 'get_protein_structure' });
    expect(result.uniProtKBCrossReferences).toEqual([{ database: 'GO', id: 'GO:123' }]);
    expect(entry.uniProtKBCrossReferences).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('evidences');
    expect(entry.sequence.value).toBe('AKD');
  });
  it('returns only sequence data for JSON', async () => {
    const calls = mock();
    expect(await handlers.get_protein_sequence({ accession: 'P04637', format: 'json' })).toEqual({ accession: 'P04637', ...entry.sequence });
    expect(calls[0].params).toEqual({ format: 'json', fields: ENTRY_FIELDS.sequence });
  });
  it.each(['get_protein_info', 'get_protein_sequence'])('preserves FASTA for %s', async tool => {
    const calls = mock('>P04637\nAKD\n');
    expect(await handlers[tool]({ accession: 'P04637', ...(tool === 'get_protein_info' ? { format: 'fasta' } : {}) })).toBe('>P04637\nAKD\n');
    expect(calls[0].params).toEqual({ format: 'fasta' });
  });
  it('builds slim XML and preserves field-selected TSV', async () => {
    const calls = mock();
    const xml = await handlers.get_protein_info({ accession: 'P04637', format: 'xml' });
    expect(new XMLParser().parse(xml as string).protein.primaryAccession).toBe('P04637');
    expect(xml).not.toContain('evidences');
    expect(calls[0].params).toEqual({ format: 'json', fields: INFO_FIELDS });
    mock('Entry\nP04637\n');
    expect(await handlers.get_protein_info({ accession: 'P04637', format: 'tsv' })).toBe('Entry\nP04637\n');
  });
});

describe('export formats', () => {
  it.each(['gff', 'txt', 'xml', 'fasta'])('returns raw %s text', async format => {
    const calls = mock('raw export');
    expect(await handlers.export_protein_data({ accession: 'P04637', format })).toBe('raw export');
    expect(calls[0].params).toEqual({ format });
  });
  it.each(['genbank', 'embl', 'rdf'])('rejects %s before calling UniProt', async format => {
    const calls = mock();
    await expect(handlers.export_protein_data({ accession: 'P04637', format })).rejects.toThrow('gff, txt, xml, fasta');
    expect(calls).toHaveLength(0);
  });
});
