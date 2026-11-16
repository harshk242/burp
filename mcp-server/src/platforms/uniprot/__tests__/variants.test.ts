import { afterEach, describe, expect, it } from 'vitest';
import { initClient, resetClient } from '../client.js';
import { proteinHandlers as handlers } from '../tools/protein-handlers.js';
import { clinicalSignificance } from '../variants.js';

const evidence = { evidenceCode: 'ECO:0000269', source: 'PubMed', id: '123' };
const variant = (description: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'Natural variant', description, ...extra });
// Descriptions follow live UniProt wording (BRCA1 P38398, TP53 P04637, CFTR P13569).
const entry = {
  primaryAccession: 'P04637',
  comments: [{ commentType: 'DISEASE', disease: { acronym: 'LFS', evidences: [evidence] } },
    { commentType: 'DISEASE', disease: { acronym: 'BC' } },
    { commentType: 'DISEASE', disease: { acronym: 'A+B' } },
    { commentType: 'DISEASE', note: { texts: [{ value: 'note-only disease comment' }] } },
    { commentType: 'POLYMORPHISM', texts: [{ value: 'common', evidences: [evidence] }] }],
  features: [
    variant('in LFS; germline mutation; dbSNP:rs123', { evidences: [evidence, evidence] }),
    variant('in BC and OC; pathogenic; no interaction with BAP1; dbSNP:rs28897672'),
    variant('in BC; likely pathogenic'),
    variant('in BC; benign; functionally neutral in vitro; dbSNP:rs80357102'),
    variant('in BC; likely benign'),
    variant('in BC; Uncertain significance; dbSNP:rs786203152'),
    variant('in a familial cancer not matching LFS; germline mutation'),
    variant('in BROVCA12; uncertain significance'),
    variant('found in breast-ovarian cancer patients; uncertain significance'),
    variant('in a sporadic cancer; somatic mutation'),
    variant('in A+B'),
    { type: 'Mutagenesis', description: 'in LFS' },
  ],
};
function mock(data: unknown = entry) {
  initClient({}, { adapter: async config => ({ data, status: 200, statusText: 'OK', headers: {}, config }) });
}
afterEach(resetClient);

describe('clinical significance parsing', () => {
  it.each([
    ['in BC; pathogenic; dbSNP:rs1', 'pathogenic'],
    ['in BC; Likely Pathogenic', 'likely pathogenic'],
    ['in BC; uncertain significance', 'uncertain significance'],
    ['in BC; benign; functionally neutral in vitro', 'benign'],
    ['in BC; likely benign', 'likely benign'],
    ['in BC; no effect on pathogenic activity', undefined],
    ['in LFS', undefined],
    [undefined, undefined],
  ])('%s -> %s', (description, expected) => {
    expect(clinicalSignificance(description)).toBe(expected);
  });
});

describe('get_protein_variants disease classification', () => {
  it('excludes benign, likely benign, uncertain and negated disease mentions', async () => {
    mock();
    const result: any = await handlers.get_protein_variants!({ accession: 'P04637' });
    expect(result.naturalVariantCount).toBe(11);
    expect(result.diseaseVariants.map((f: any) => [f.description.split(';')[0], f.diseases])).toEqual([
      ['in LFS', ['LFS']], ['in BC and OC', ['BC']], ['in BC', ['BC']], ['in A+B', ['A+B']],
    ]);
    expect(result.diseaseVariantCount).toBe(4);
    expect(result.excludedDiseaseMentionCount).toBe(3);
    expect(result.significanceCounts).toEqual({
      pathogenic: 1, 'likely pathogenic': 1, benign: 1, 'likely benign': 1, 'uncertain significance': 3,
    });
    expect(result.diseaseAcronyms).toEqual(['LFS', 'BC', 'A+B']);
    expect(result.diseaseVariantCriterion).toMatch(/not a clinical pathogenicity classification/);
  });
  it('keeps every natural variant with its stated significance and strips evidences', async () => {
    mock();
    const result: any = await handlers.get_protein_variants!({ accession: 'P04637' });
    expect(result.naturalVariants.find((f: any) => f.description.startsWith('in BC; benign')))
      .toMatchObject({ clinicalSignificance: 'benign' });
    expect(result.naturalVariants[0]).not.toHaveProperty('clinicalSignificance');
    expect(result.mutagenesisFeatures).toHaveLength(1);
    expect(result.polymorphisms).toEqual([{ commentType: 'POLYMORPHISM', texts: [{ value: 'common' }] }]);
    expect(JSON.stringify(result)).not.toContain('evidences');
  });
  it('reports no disease variants without DISEASE comments', async () => {
    mock({ features: [variant('in LFS')] });
    expect(await handlers.get_protein_variants!({ accession: 'X' })).toMatchObject({
      diseaseVariants: [], diseaseVariantCount: 0, excludedDiseaseMentionCount: 0, naturalVariantCount: 1,
    });
  });
});
