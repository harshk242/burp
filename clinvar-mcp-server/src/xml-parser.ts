// XML Parser for ClinVar E-utilities responses

import { XMLParser } from 'fast-xml-parser';
import { XMLParseError } from './exceptions.js';
import { ensureArray, extractText, normalizeClinicalSignificance, normalizeReviewStatus } from './utils.js';
import type {
  VariantInfo,
  VCVRecord,
  RCVRecord,
  ClinicalAssertion,
  GeneInfo,
  GenomicLocation,
  HGVSExpressions,
  ClinicalSignificance,
  Condition,
  Submitter,
  SubmissionRecord,
} from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = Record<string, any>;

// Configure XML parser for ClinVar responses
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  isArray: (name) => {
    const arrayElements = [
      'VariationArchive', 'RCVAccession', 'ClinicalAssertion',
      'Gene', 'Trait', 'TraitSet', 'Citation', 'SequenceLocation',
      'HGVS', 'Submission', 'SubmittedInterpretation', 'Interpretation'
    ];
    return arrayElements.includes(name);
  },
});

/**
 * Parse ESearch response for ClinVar
 */
export function parseESearchResult(xml: string): { count: number; idList: string[] } {
  try {
    const result = parser.parse(xml);
    const searchResult = result.eSearchResult;

    if (!searchResult) {
      throw new XMLParseError('Invalid ESearch response: missing eSearchResult');
    }

    const idList = searchResult.IdList?.Id || [];

    return {
      count: parseInt(searchResult.Count || '0', 10),
      idList: ensureArray(idList).map(String),
    };
  } catch (error) {
    if (error instanceof XMLParseError) throw error;
    throw new XMLParseError(`Failed to parse ESearch response: ${error}`, xml);
  }
}

/**
 * Parse ClinVar VCV (Variation) record from EFetch
 */
export function parseVCVRecord(xml: string): VCVRecord[] {
  try {
    const result = parser.parse(xml);
    const variationArchives = result.ClinVarResult?.VariationArchive ||
                               result.ClinVarVariationRelease?.VariationArchive || [];

    return ensureArray(variationArchives).map((archive: AnyObject) => {
      const interpretedRecord = archive.InterpretedRecord as AnyObject || {};
      const simpleAllele = interpretedRecord.SimpleAllele as AnyObject || archive.ClassifiedRecord?.SimpleAllele as AnyObject || {};

      // Extract gene info
      const geneList = simpleAllele.GeneList?.Gene || [];
      const primaryGene = ensureArray(geneList)[0] as AnyObject | undefined;
      const gene: GeneInfo | undefined = primaryGene ? {
        geneId: extractText(primaryGene['@_GeneID']),
        symbol: extractText(primaryGene['@_Symbol']) || extractText(primaryGene.Symbol),
        fullName: extractText(primaryGene.FullName),
        hgncId: extractText(primaryGene['@_HGNC_ID']),
      } : undefined;

      // Extract location
      const sequenceLocations = simpleAllele.Location?.SequenceLocation || [];
      const grch38Location = ensureArray(sequenceLocations).find(
        (loc: AnyObject) => extractText(loc['@_Assembly']) === 'GRCh38'
      ) as AnyObject | undefined;

      const location: GenomicLocation | undefined = grch38Location ? {
        assembly: 'GRCh38',
        chromosome: extractText(grch38Location['@_Chr']),
        start: parseInt(extractText(grch38Location['@_start']) || '0', 10),
        stop: parseInt(extractText(grch38Location['@_stop']) || '0', 10),
        referenceAllele: extractText(grch38Location['@_referenceAllele']),
        alternateAllele: extractText(grch38Location['@_alternateAllele']),
        cytogeneticLocation: extractText(simpleAllele.Location?.CytogeneticLocation),
      } : undefined;

      // Extract HGVS
      const hgvsExpressions = simpleAllele.HGVSlist?.HGVS || [];
      const hgvs: HGVSExpressions = {};
      for (const expr of ensureArray(hgvsExpressions)) {
        const exprObj = expr as AnyObject;
        const type = extractText(exprObj['@_Type']);
        const nucleotideExpr = extractText(exprObj.NucleotideExpression?.Expression);
        const proteinExpr = extractText(exprObj.ProteinExpression?.Expression);

        if (type === 'genomic' || type === 'genomic, top-level') {
          hgvs.genomic = nucleotideExpr;
        } else if (type === 'coding') {
          hgvs.coding = nucleotideExpr;
        }
        if (proteinExpr) {
          hgvs.protein = proteinExpr;
        }
      }

      // Extract clinical assertions
      const assertions = interpretedRecord.ClinicalAssertionList?.ClinicalAssertion ||
                        archive.ClassifiedRecord?.ClinicalAssertionList?.ClinicalAssertion || [];
      const clinicalAssertions: ClinicalAssertion[] = ensureArray(assertions).map((assertion: AnyObject) => {
        const interpretation = assertion.Interpretation as AnyObject || {};
        const traitSet = assertion.TraitSet as AnyObject || {};
        const submitter = assertion.ClinVarSubmissionID as AnyObject || assertion.ClinVarAccession as AnyObject || {};

        return {
          id: extractText(assertion['@_ID']),
          clinicalSignificance: {
            description: normalizeClinicalSignificance(extractText(interpretation.Description)) as any,
            dateLastEvaluated: extractText(interpretation['@_DateLastEvaluated']),
            reviewStatus: normalizeReviewStatus(extractText(assertion.ReviewStatus)) as any,
          },
          condition: parseCondition(traitSet),
          submitter: {
            submitterId: extractText(submitter['@_OrgID']),
            name: extractText(submitter['@_submitter']) || extractText(submitter.SubmitterName),
            abbreviation: extractText(submitter['@_submitterAbbrev']),
          },
          methodType: extractText(assertion.ObservedInList?.ObservedIn?.Method?.MethodType),
          dateSubmitted: extractText(assertion['@_DateCreated']),
          dateLastUpdated: extractText(assertion['@_DateLastUpdated']),
        };
      });

      // Extract aggregated classification
      const classification = interpretedRecord.Interpretations?.Interpretation?.[0] as AnyObject ||
                            archive.ClassifiedRecord?.Classifications?.GermlineClassification as AnyObject || {};
      const aggregatedClassification: ClinicalSignificance | undefined = classification ? {
        description: normalizeClinicalSignificance(extractText(classification.Description)) as any,
        dateLastEvaluated: extractText(classification['@_DateLastEvaluated']),
        reviewStatus: normalizeReviewStatus(extractText(classification.ReviewStatus)) as any,
        submissionCount: clinicalAssertions.length,
      } : undefined;

      return {
        accession: extractText(archive['@_Accession']) || extractText(archive['@_VariationID']),
        version: parseInt(extractText(archive['@_Version']) || '1', 10),
        variationId: extractText(archive['@_VariationID']),
        name: extractText(archive['@_VariationName']) || extractText(simpleAllele.Name),
        variantType: extractText(simpleAllele.VariantType) as any,
        gene,
        location,
        hgvs,
        clinicalAssertions,
        aggregatedClassification,
      };
    });
  } catch (error) {
    if (error instanceof XMLParseError) throw error;
    throw new XMLParseError(`Failed to parse VCV record: ${error}`, xml);
  }
}

/**
 * Parse condition/trait from ClinVar data
 */
function parseCondition(traitSet: AnyObject): Condition {
  const traits = ensureArray(traitSet.Trait || []);
  const primaryTrait = traits[0] as AnyObject | undefined;

  if (!primaryTrait) {
    return { name: 'not provided' };
  }

  const xrefs = ensureArray(primaryTrait.XRef || []);
  let medGenId: string | undefined;
  let omimId: string | undefined;
  let orphanetId: string | undefined;

  for (const xref of xrefs) {
    const xrefObj = xref as AnyObject;
    const db = extractText(xrefObj['@_DB']).toLowerCase();
    const id = extractText(xrefObj['@_ID']);

    if (db === 'medgen') medGenId = id;
    else if (db === 'omim') omimId = id;
    else if (db === 'orphanet') orphanetId = id;
  }

  return {
    name: extractText(primaryTrait.Name?.ElementValue) || extractText(primaryTrait['@_Type']),
    medGenId,
    omimId,
    orphanetId,
    trait: extractText(primaryTrait['@_Type']),
  };
}

/**
 * Parse ESummary response for ClinVar
 */
export function parseESummaryResult(xml: string): VariantInfo[] {
  try {
    const result = parser.parse(xml);
    const docSums = result.eSummaryResult?.DocumentSummarySet?.DocumentSummary ||
                   result.eSummaryResult?.DocSum || [];

    return ensureArray(docSums).map((doc: AnyObject) => {
      // Handle both XML formats
      const uid = extractText(doc['@_uid']) || extractText(doc.Id);

      // Extract from Item elements if present
      const items = ensureArray(doc.Item || []);
      const itemMap: AnyObject = {};
      for (const item of items) {
        const itemObj = item as AnyObject;
        const name = itemObj['@_Name'];
        itemMap[name] = extractText(item);
      }

      const geneSymbol = itemMap.gene_sort || extractText(doc.gene_sort) ||
                        extractText(doc.genes?.gene?.symbol);

      return {
        variationId: uid,
        name: itemMap.title || extractText(doc.title) || extractText(doc.variation_name),
        variantType: itemMap.variant_type || extractText(doc.variant_type),
        gene: geneSymbol ? { symbol: geneSymbol } : undefined,
        clinicalSignificance: {
          description: normalizeClinicalSignificance(
            itemMap.clinical_significance || extractText(doc.clinical_significance?.description)
          ) as any,
          reviewStatus: normalizeReviewStatus(
            itemMap.review_status || extractText(doc.review_status)
          ) as any,
        },
        rsId: itemMap.rs || extractText(doc.variation_set?.variation?.dbsnp_id),
      };
    });
  } catch (error) {
    if (error instanceof XMLParseError) throw error;
    throw new XMLParseError(`Failed to parse ESummary response: ${error}`, xml);
  }
}

/**
 * Parse submission records from VCV
 */
export function parseSubmissions(vcvRecord: VCVRecord): SubmissionRecord[] {
  return vcvRecord.clinicalAssertions.map((assertion) => ({
    submissionId: assertion.id,
    submitter: assertion.submitter,
    clinicalSignificance: assertion.clinicalSignificance,
    condition: assertion.condition,
    methodType: assertion.methodType,
    dateSubmitted: assertion.dateSubmitted,
    dateLastUpdated: assertion.dateLastUpdated,
  }));
}
