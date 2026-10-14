import { describe, expect, it } from 'vitest';
import { parseESearchResult, parseESummaryResult, parseVCVRecord } from '../xml-parser.js';
import { normalizeClinicalSignificance, toVariationId } from '../utils.js';

const ESUMMARY = `<?xml version="1.0" encoding="UTF-8" ?>
<eSummaryResult>
<DocumentSummarySet status="OK">
<DocumentSummary uid="5005761">
	<obj_type>Deletion</obj_type>
	<accession>VCV005005761</accession>
	<title>NM_007294.4(BRCA1):c.387del (p.Tyr130fs)</title>
	<variation_set>
		<variation>
			<variation_xrefs>
				<variation_xref><db_source>OMIM</db_source><db_id>113705.0002</db_id></variation_xref>
				<variation_xref><db_source>dbSNP</db_source><db_id>28897672</db_id></variation_xref>
			</variation_xrefs>
			<variation_name>NM_007294.4(BRCA1):c.387del (p.Tyr130fs)</variation_name>
			<variant_type>Deletion</variant_type>
		</variation>
	</variation_set>
	<germline_classification>
		<description>Pathogenic</description>
		<review_status>criteria provided, single submitter</review_status>
	</germline_classification>
	<gene_sort>BRCA1</gene_sort>
</DocumentSummary>
</DocumentSummarySet>
</eSummaryResult>`;

const VCV = `<?xml version="1.0" encoding="UTF-8" ?>
<ClinVarResult-Set><VariationArchive VariationID="5005761" VariationName="NM_007294.4(BRCA1):c.387del (p.Tyr130fs)" VariationType="Deletion" Accession="VCV005005761" Version="1" RecordType="classified">
  <ClassifiedRecord>
    <SimpleAllele AlleleID="1245810" VariationID="5005761">
      <GeneList><Gene Symbol="BRCA1" FullName="BRCA1 DNA repair associated" GeneID="672" HGNC_ID="HGNC:1100"/></GeneList>
      <VariantType>Deletion</VariantType>
    </SimpleAllele>
    <Classifications>
      <GermlineClassification NumberOfSubmissions="1" DateLastEvaluated="2026-09-30">
        <ReviewStatus>criteria provided, single submitter</ReviewStatus>
        <Description>Likely pathogenic</Description>
      </GermlineClassification>
    </Classifications>
    <ClinicalAssertionList>
      <ClinicalAssertion ID="15275337" DateLastUpdated="2026-10-03" DateCreated="2026-10-03">
        <ClinVarSubmissionID localKey="NM_007294.4:c.387del" submittedAssembly="GRCh38"/>
        <ClinVarAccession Accession="SCV008080823" Type="SCV" Version="1" SubmitterName="Juno Genomics" OrgID="506213"/>
        <Classification DateLastEvaluated="2026-09-30">
          <ReviewStatus>criteria provided, single submitter</ReviewStatus>
          <GermlineClassification>Likely pathogenic</GermlineClassification>
        </Classification>
        <TraitSet Type="Disease"><Trait Type="Disease"><Name><ElementValue Type="Preferred">Fanconi anemia</ElementValue></Name></Trait></TraitSet>
      </ClinicalAssertion>
    </ClinicalAssertionList>
  </ClassifiedRecord>
</VariationArchive></ClinVarResult-Set>`;

describe('parseESummaryResult', () => {
  it('reads germline_classification, the nested variant type and the dbSNP xref', () => {
    const [variant] = parseESummaryResult(ESUMMARY);
    expect(variant).toMatchObject({
      variationId: '5005761',
      name: 'NM_007294.4(BRCA1):c.387del (p.Tyr130fs)',
      variantType: 'Deletion',
      gene: { symbol: 'BRCA1' },
      clinicalSignificance: {
        description: 'Pathogenic',
        reviewStatus: 'criteria provided, single submitter',
      },
      rsId: 'rs28897672',
    });
  });
});

describe('parseVCVRecord', () => {
  it('reads the ClinVarResult-Set root, the aggregate and per-submission classifications', () => {
    const [record] = parseVCVRecord(VCV);
    expect(record.variationId).toBe('5005761');
    expect(record.gene?.symbol).toBe('BRCA1');
    expect(record.aggregatedClassification).toMatchObject({
      description: 'Likely pathogenic',
      reviewStatus: 'criteria provided, single submitter',
      submissionCount: 1,
    });
    expect(record.clinicalAssertions).toHaveLength(1);
    expect(record.clinicalAssertions[0]).toMatchObject({
      id: '15275337',
      clinicalSignificance: {
        description: 'Likely pathogenic',
        dateLastEvaluated: '2026-09-30',
        reviewStatus: 'criteria provided, single submitter',
      },
      submitter: { submitterId: '506213', name: 'Juno Genomics' },
      condition: { name: 'Fanconi anemia' },
    });
  });

  it('returns no records for an empty result set', () => {
    expect(parseVCVRecord('<ClinVarResult-Set><set/></ClinVarResult-Set>')).toEqual([]);
  });
});

describe('normalizeClinicalSignificance', () => {
  it('keeps "likely" and conflicting terms distinct from the definite ones', () => {
    expect(normalizeClinicalSignificance('Likely pathogenic')).toBe('Likely pathogenic');
    expect(normalizeClinicalSignificance('likely benign')).toBe('Likely benign');
    expect(normalizeClinicalSignificance('PATHOGENIC')).toBe('Pathogenic');
    expect(normalizeClinicalSignificance('Conflicting classifications of pathogenicity'))
      .toBe('Conflicting classifications of pathogenicity');
    expect(normalizeClinicalSignificance('Pathogenic/Likely pathogenic')).toBe('Pathogenic/Likely pathogenic');
  });
});

describe('toVariationId', () => {
  it('accepts numeric IDs and VCV accessions', () => {
    expect(toVariationId('17661')).toBe('17661');
    expect(toVariationId('VCV000017661')).toBe('17661');
    expect(toVariationId('VCV000017661.150')).toBe('17661');
  });
});

describe('XML boundary validation', () => {
  it.each([
    VCV.replace('VariationID="5005761"', ''),
    VCV.replace('VariationName="NM_007294.4(BRCA1):c.387del (p.Tyr130fs)"', ''),
    VCV.replace('Version="1"', 'Version="invalid"'),
    VCV.replace('ID="15275337"', ''),
    VCV.replace('Symbol="BRCA1"', ''),
    VCV.replace('SubmitterName="Juno Genomics"', ''),
    '<unexpected/>',
    '<ClinVarResult-Set><VariationArchive>bad</VariationArchive></ClinVarResult-Set>',
  ])('rejects malformed VCV records instead of emitting incomplete domain records', xml => {
    expect(() => parseVCVRecord(xml)).toThrow();
  });
  it('requires a summary identifier and name', () => {
    expect(() => parseESummaryResult(ESUMMARY.replace('uid="5005761"', ''))).toThrow('variation ID');
    expect(() => parseESummaryResult('<eSummaryResult><DocSum><Id>1</Id></DocSum></eSummaryResult>')).toThrow('variant name');
  });
  it('normalizes singleton and repeated summary records', () => {
    const doc = '<DocumentSummary uid="1"><title>variant</title></DocumentSummary>';
    expect(parseESummaryResult(`<eSummaryResult><DocumentSummarySet>${doc}${doc}</DocumentSummarySet></eSummaryResult>`)).toHaveLength(2);
    expect(parseESummaryResult(`<eSummaryResult><DocumentSummarySet>${doc}</DocumentSummarySet></eSummaryResult>`)).toHaveLength(1);
  });
  it('preserves new upstream classification terms without type assertions', () => {
    expect(parseESummaryResult(ESUMMARY.replace('<description>Pathogenic</description>', '<description>Pathogenic/Likely pathogenic</description>'))[0].clinicalSignificance?.description).toBe('Pathogenic/Likely pathogenic');
  });
});

describe('ESearch boundary decoding', () => {
  it('normalizes singleton identifiers and validates the required count', () => {
    expect(parseESearchResult('<eSearchResult><Count>1</Count><IdList><Id>123</Id></IdList></eSearchResult>')).toEqual({ count: 1, idList: ['123'] });
    expect(() => parseESearchResult('<eSearchResult><Count>bad</Count></eSearchResult>')).toThrow('Count');
    expect(() => parseESearchResult('<eSearchResult><IdList/></eSearchResult>')).toThrow('Count');
  });
  it('propagates upstream error envelopes instead of returning empty records', () => {
    expect(() => parseESearchResult('<eSearchResult><ERROR>invalid query</ERROR></eSearchResult>')).toThrow('invalid query');
    expect(() => parseESummaryResult('<eSummaryResult><ERROR>invalid identifier</ERROR></eSummaryResult>')).toThrow('invalid identifier');
  });
});
