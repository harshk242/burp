import { decodeXml, node, at, many as ensureArray, text as extractText, required, integer, type XmlValue } from './xml-decoding.js';
import { XMLParser } from 'fast-xml-parser';
import { XMLParseError } from './exceptions.js';
import { normalizeClinicalSignificance, normalizeReviewStatus } from './utils.js';
import type { VariantInfo, VCVRecord, ClinicalAssertion, GeneInfo, GenomicLocation, HGVSExpressions, ClinicalSignificance, Condition, SubmissionRecord, } from './types.js';
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

export function parseESearchResult(xml: string): {
  count: number;
  idList: string[];
} {
  try {
    const result = decodeXml(parser.parse(xml));
    if (at(result, 'ERROR')) throw new XMLParseError(extractText(at(result, 'ERROR')));
    const searchResult = at(result, 'eSearchResult');
    if (!searchResult) {
      throw new XMLParseError('Invalid ESearch response: missing eSearchResult');
    }
    if (at(searchResult, 'ERROR')) throw new XMLParseError(extractText(at(searchResult, 'ERROR')));
    const idList = at(searchResult, 'IdList', 'Id') || [];
    return {
      count: integer(at(searchResult, 'Count'), 'Count'),
      idList: ensureArray(idList).map(id => required(id, 'Id')),
    };
  }
  catch (error) {
    if (error instanceof XMLParseError)
      throw error;
    throw new XMLParseError(`Failed to parse ESearch response: ${error}`, xml);
  }
}

export function parseVCVRecord(xml: string): VCVRecord[] {
  try {
    const result = decodeXml(parser.parse(xml));
    // `ClinVarResult-Set` is what efetch rettype=vcv returns today.
    if (!at(result, 'ClinVarResult-Set') && !at(result, 'ClinVarResult') && !at(result, 'ClinVarVariationRelease')) throw new XMLParseError('Missing ClinVar result root');
    const variationArchives = at(result, 'ClinVarResult-Set', 'VariationArchive') || at(result, 'ClinVarResult', 'VariationArchive') || at(result, 'ClinVarVariationRelease', 'VariationArchive') || [];
    return ensureArray(variationArchives).map((archive: XmlValue) => {
      const interpretedRecord = node(at(archive, 'InterpretedRecord'));
      const simpleAllele = at(interpretedRecord, 'SimpleAllele') || at(archive, 'ClassifiedRecord', 'SimpleAllele') || {};
      const geneList = at(simpleAllele, 'GeneList', 'Gene') || [];
      const primaryGene = ensureArray(geneList)[0];
      const gene: GeneInfo | undefined = primaryGene ? {
        geneId: extractText(at(primaryGene, '@_GeneID')),
        symbol: required(at(primaryGene, '@_Symbol') || at(primaryGene, 'Symbol'), 'gene symbol'),
        fullName: extractText(at(primaryGene, 'FullName')),
        hgncId: extractText(at(primaryGene, '@_HGNC_ID')),
      } : undefined;
      const sequenceLocations = at(simpleAllele, 'Location', 'SequenceLocation') || [];
      const grch38Location = ensureArray(sequenceLocations).find((loc: XmlValue) => extractText(at(loc, '@_Assembly')) === 'GRCh38');
      const location: GenomicLocation | undefined = grch38Location ? {
        assembly: 'GRCh38',
        chromosome: required(at(grch38Location, '@_Chr'), 'chromosome'),
        start: integer(at(grch38Location, '@_start'), 'start'),
        stop: integer(at(grch38Location, '@_stop'), 'stop'),
        referenceAllele: extractText(at(grch38Location, '@_referenceAllele')),
        alternateAllele: extractText(at(grch38Location, '@_alternateAllele')),
        cytogeneticLocation: extractText(at(simpleAllele, 'Location', 'CytogeneticLocation')),
      } : undefined;
      const hgvsExpressions = at(simpleAllele, 'HGVSlist', 'HGVS') || [];
      const hgvs: HGVSExpressions = {};
      for (const expr of ensureArray(hgvsExpressions)) {
        const exprObj = expr;
        const type = extractText(at(exprObj, '@_Type'));
        const nucleotideExpr = extractText(at(exprObj, 'NucleotideExpression', 'Expression'));
        const proteinExpr = extractText(at(exprObj, 'ProteinExpression', 'Expression'));
        if (type === 'genomic' || type === 'genomic, top-level') {
          hgvs.genomic = nucleotideExpr;
        }
        else if (type === 'coding') {
          hgvs.coding = nucleotideExpr;
        }
        if (proteinExpr) {
          hgvs.protein = proteinExpr;
        }
      }
      const assertions = at(interpretedRecord, 'ClinicalAssertionList', 'ClinicalAssertion') || at(archive, 'ClassifiedRecord', 'ClinicalAssertionList', 'ClinicalAssertion') || [];
      const clinicalAssertions: ClinicalAssertion[] = ensureArray(assertions).map((assertion: XmlValue) => {
        // Current schema: Classification { ReviewStatus, GermlineClassification };
        // older records: Interpretation { Description } with a sibling ReviewStatus.
        const classification = at(assertion, 'Classification');
        const interpretation = ensureArray(at(assertion, 'Interpretation'))[0] || {};
        const traitSet = ensureArray(at(assertion, 'TraitSet'))[0] || {};
        const submission = at(assertion, 'ClinVarSubmissionID') || {};
        const accession = at(assertion, 'ClinVarAccession') || {};
        return {
          id: required(at(assertion, '@_ID'), 'assertion ID'),
          clinicalSignificance: {
            description: normalizeClinicalSignificance(extractText(at(classification, 'GermlineClassification')) || extractText(at(interpretation, 'Description'))),
            dateLastEvaluated: extractText(at(classification, '@_DateLastEvaluated')) ||
              extractText(at(interpretation, '@_DateLastEvaluated')),
            reviewStatus: normalizeReviewStatus(extractText(at(classification, 'ReviewStatus')) || extractText(at(assertion, 'ReviewStatus'))),
          },
          condition: parseCondition(traitSet),
          submitter: {
            submitterId: extractText(at(accession, '@_OrgID')) || extractText(at(submission, '@_OrgID')),
            name: required(at(accession, '@_SubmitterName') || at(submission, '@_submitter') || at(submission, 'SubmitterName'), 'submitter name'),
            abbreviation: extractText(at(submission, '@_submitterAbbrev')),
          },
          methodType: extractText(at(ensureArray(at(assertion, 'ObservedInList', 'ObservedIn'))[0], 'Method', 'MethodType')),
          dateSubmitted: extractText(at(assertion, '@_DateCreated')),
          dateLastUpdated: extractText(at(assertion, '@_DateLastUpdated')),
        };
      });
      const classification = ensureArray(at(interpretedRecord, 'Interpretations', 'Interpretation'))[0] ||
        at(archive, 'ClassifiedRecord', 'Classifications', 'GermlineClassification') || undefined;
      const aggregatedClassification: ClinicalSignificance | undefined = classification ? {
        description: normalizeClinicalSignificance(extractText(at(classification, 'Description'))),
        dateLastEvaluated: extractText(at(classification, '@_DateLastEvaluated')),
        reviewStatus: normalizeReviewStatus(extractText(at(classification, 'ReviewStatus'))),
        submissionCount: clinicalAssertions.length,
      } : undefined;
      return {
        accession: extractText(at(archive, '@_Accession')) || extractText(at(archive, '@_VariationID')),
        version: integer(at(archive, '@_Version'), 'version', 1),
        variationId: required(at(archive, '@_VariationID'), 'VariationID'),
        name: required(at(archive, '@_VariationName') || at(simpleAllele, 'Name'), 'variant name'),
        variantType: extractText(at(simpleAllele, 'VariantType')),
        gene,
        location,
        hgvs,
        clinicalAssertions,
        aggregatedClassification,
      };
    });
  }
  catch (error) {
    if (error instanceof XMLParseError)
      throw error;
    throw new XMLParseError(`Failed to parse VCV record: ${error}`, xml);
  }
}
function parseCondition(traitSet: XmlValue): Condition {
  const traits = ensureArray(at(traitSet, 'Trait') || []);
  const primaryTrait = traits[0];
  if (!primaryTrait) {
    return { name: 'not provided' };
  }
  const xrefs = ensureArray(at(primaryTrait, 'XRef') || []);
  let medGenId: string | undefined;
  let omimId: string | undefined;
  let orphanetId: string | undefined;
  for (const xref of xrefs) {
    const xrefObj = xref;
    const db = extractText(at(xrefObj, '@_DB')).toLowerCase();
    const id = extractText(at(xrefObj, '@_ID'));
    if (db === 'medgen')
      medGenId = id;
    else if (db === 'omim')
      omimId = id;
    else if (db === 'orphanet')
      orphanetId = id;
  }
  return {
    name: extractText(at(primaryTrait, 'Name', 'ElementValue')) || extractText(at(primaryTrait, '@_Type')),
    medGenId,
    omimId,
    orphanetId,
    trait: extractText(at(primaryTrait, '@_Type')),
  };
}

export function parseESummaryResult(xml: string): VariantInfo[] {
  try {
    const result = decodeXml(parser.parse(xml));
    if (!at(result, 'eSummaryResult')) throw new XMLParseError('Missing eSummaryResult');
    if (at(result, 'eSummaryResult', 'ERROR')) throw new XMLParseError(extractText(at(result, 'eSummaryResult', 'ERROR')));
    const docSums = at(result, 'eSummaryResult', 'DocumentSummarySet', 'DocumentSummary') || at(result, 'eSummaryResult', 'DocSum') || [];
    return ensureArray(docSums).map((doc: XmlValue) => {
      const uid = extractText(at(doc, '@_uid')) || extractText(at(doc, 'Id'));
      const items = ensureArray(at(doc, 'Item') || []);
      const itemMap: Record<string, string> = Object.create(null);
      for (const item of items) {
        const itemObj = item;
        const name = required(at(itemObj, '@_Name'), 'item name');
        itemMap[name] = extractText(item);
      }
      const geneSymbol = itemMap.gene_sort || extractText(at(doc, 'gene_sort')) ||
        extractText(at(ensureArray(at(doc, 'genes', 'gene'))[0], 'symbol'));
      // Since the 2024 DTD the classification is `germline_classification`;
      // `clinical_significance` is the pre-2024 element.
      const classification = (at(doc, 'germline_classification') || at(doc, 'clinical_significance') || {});
      const variation = ensureArray(at(doc, 'variation_set', 'variation'))[0];
      const dbsnpXref = ensureArray(at(variation, 'variation_xrefs', 'variation_xref')).find((xref: XmlValue) => extractText(at(xref, 'db_source')) === 'dbSNP');
      const rsNumber = itemMap.rs || extractText(at(variation, 'dbsnp_id')) || extractText(at(dbsnpXref, 'db_id'));
      return {
        variationId: required(uid, 'variation ID'),
        name: required(itemMap.title || at(doc, 'title') || at(variation, 'variation_name'), 'variant name'),
        variantType: itemMap.variant_type || extractText(at(variation, 'variant_type')) ||
          extractText(at(doc, 'variant_type')) || extractText(at(doc, 'obj_type')),
        gene: geneSymbol ? { symbol: geneSymbol } : undefined,
        clinicalSignificance: {
          description: normalizeClinicalSignificance(itemMap.clinical_significance || extractText(at(classification, 'description'))),
          reviewStatus: normalizeReviewStatus(itemMap.review_status || extractText(at(classification, 'review_status')) || extractText(at(doc, 'review_status'))),
        },
        rsId: rsNumber ? `rs${rsNumber.replace(/^rs/i, '')}` : undefined,
      };
    });
  }
  catch (error) {
    if (error instanceof XMLParseError)
      throw error;
    throw new XMLParseError(`Failed to parse ESummary response: ${error}`, xml);
  }
}

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
