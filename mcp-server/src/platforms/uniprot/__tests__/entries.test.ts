import { afterEach, describe, expect, it } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { initClient, resetClient } from '../client.js';
import { proteinHandlers as handlers } from '../tools/protein-handlers.js';
import { FEATURE_FIELDS, COMMENT_FIELDS, CROSS_REFERENCE_FIELDS, INFO_FIELDS } from '../entry-fields.js';
import { SEARCH_FIELDS } from '../search-fields.js';

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
  uniProtKBCrossReferences: [{ database: 'PDB', id: '1ABC' }, { database: 'GO', id: 'GO:123' }],
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

const fields: [string, string][] = [
  ['get_protein_features', `accession,id,${FEATURE_FIELDS},${COMMENT_FIELDS},keyword`],
  ['get_protein_structure', 'accession,xref_pdb,ft_turn,ft_helix,ft_strand,cc_subunit'],
  ['get_protein_domains_detailed', 'accession,ft_domain,ft_region,ft_repeat,xref_interpro,xref_pfam,xref_smart'],
  ['get_protein_variants', 'accession,ft_variant,ft_mutagen,cc_disease,cc_polymorphism'],
  ['analyze_sequence_composition', 'accession,sequence,mass'],
  ['get_protein_pathways', 'accession,xref_kegg,xref_reactome,cc_pathway,cc_function'],
  ['get_protein_interactions', 'accession,xref_string,xref_intact,cc_interaction,cc_subunit'],
  ['compare_proteins', "accession,id,organism_name,length,mass,feature_count"],
  ['get_phylogenetic_info', 'accession,organism_name,organism_id,lineage'],
  ['get_external_references', `accession,${CROSS_REFERENCE_FIELDS}`],
  ['get_literature_references', 'accession,lit_pubmed_id,lit_doi_id'],
  ['get_annotation_confidence', `accession,reviewed,protein_existence,annotation_score,lit_pubmed_id,${FEATURE_FIELDS}`],
  ['validate_accession', 'accession,reviewed'],
  ['get_taxonomy_info', 'accession,organism_name,organism_id,lineage'],
];
describe('entry field selection', () => {
  it.each(fields)('%s selects only the required fields', async (tool, fields) => {
    const calls = mock();
    await handlers[tool]({ accession: 'P04637', accessions: ['P04637', 'P38398'] });
    expect(calls.length).toBe(tool === 'compare_proteins' ? 2 : 1);
    for (const call of calls) expect(call.params).toEqual({ format: 'json', fields });
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
  it('matches whole disease acronyms, excludes generic cancers and strips nested evidences', async () => {
    mock();
    const result: any = await handlers.get_protein_variants({ accession: 'P04637' });
    expect(result.naturalVariantCount).toBe(5);
    expect(result.diseaseVariantCount).toBe(3);
    expect(result.diseaseVariants.map((f: any) => f.description)).toEqual(['in LFS; dbSNP:rs123', 'in BROVCA1', 'in A+B']);
    expect(JSON.stringify(result)).not.toContain('evidences');
    mock({ features: [{ type: 'Natural variant', description: 'in LFS' }] });
    expect(await handlers.get_protein_variants({ accession: 'X' })).toMatchObject({ diseaseVariants: [] });
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
        PDB: { count: 1, references: [{ database: 'PDB', id: '1ABC' }] },
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
    expect(JSON.stringify(result)).not.toContain('evidences');
    expect(entry.sequence.value).toBe('AKD');
  });
  it('returns only sequence data for JSON', async () => {
    const calls = mock();
    expect(await handlers.get_protein_sequence({ accession: 'P04637', format: 'json' })).toEqual({ accession: 'P04637', ...entry.sequence });
    expect(calls[0].params).toEqual({ format: 'json', fields: 'accession,sequence,mass,length' });
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

describe('batch summaries', () => {
  it('uses one query, preserves input order and duplicates, reports missing entries', async () => {
    const calls = mock({ results: [entry] });
    const result: any = await handlers.batch_protein_lookup({ accessions: ['P38398', 'P04637', 'P04637'] });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({ query: 'accession:"P38398" OR accession:"P04637" OR accession:"P04637"', size: 25, format: 'json', fields: SEARCH_FIELDS });
    expect(result.batchResults.map((r: any) => r.success)).toEqual([false, true, true]);
    expect(result.batchResults[1].data).toMatchObject({ accession: 'P04637', entryId: 'P53_HUMAN' });
    expect(JSON.stringify(result)).not.toContain('references');
  });
  it.each(['tsv', 'fasta'])('preserves bounded %s output', async format => {
    const calls = mock('raw output');
    expect(await handlers.batch_protein_lookup({ accessions: ['P04637'], format })).toBe('raw output');
    expect(calls[0].params.fields).toBe(format === 'fasta' ? undefined : SEARCH_FIELDS.replace(',cc_function', ''));
  });
  it.each([[], Array(26).fill('P04637'), [''], [123]])('rejects invalid accessions %j', async accessions => {
    mock();
    await expect(handlers.batch_protein_lookup({ accessions })).rejects.toThrow('1-25');
  });
  it('caps FASTA batches at ten entries', async () => {
    mock();
    await expect(handlers.batch_protein_lookup({ accessions: Array(11).fill('P04637'), format: 'fasta' })).rejects.toThrow('10');
  });
});
