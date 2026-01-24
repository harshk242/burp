// Variant API Tools
import { getClient } from '../client.js';
import { filterNoneValues } from '../utils.js';
/**
 * Retrieve core metadata and functional annotations for a variant.
 */
export async function getVariantInfo(variantId) {
    const client = getClient();
    const query = `
    query VariantInfo($variantId: String!) {
      variant(variantId: $variantId) {
        id
        variantDescription
        chromosome
        position
        referenceAllele
        alternateAllele
        hgvsId
        rsIds
        dbXrefs {
          id
          source
        }
        alleleFrequencies {
          populationName
          alleleFrequency
        }
        mostSevereConsequence {
          id
          label
        }
        transcriptConsequences {
          transcriptId
          aminoAcidChange
          codons
          consequenceScore
          impact
          lofteePrediction
          polyphenPrediction
          siftPrediction
          isEnsemblCanonical
          distanceFromTss
          uniprotAccessions
          target {
            id
            approvedSymbol
          }
          variantConsequences {
            id
            label
          }
        }
      }
    }
  `;
    return client.query(query, { variantId });
}
/**
 * List credible sets that include a specific variant.
 */
export async function getVariantCredibleSets(variantId, studyTypes, pageIndex = 0, pageSize = 10) {
    const client = getClient();
    const query = `
    query VariantCredibleSets(
      $variantId: String!,
      $studyTypes: [StudyTypeEnum!],
      $pageIndex: Int!,
      $pageSize: Int!
    ) {
      variant(variantId: $variantId) {
        id
        rsIds
        credibleSets(
          studyTypes: $studyTypes,
          page: {index: $pageIndex, size: $pageSize}
        ) {
          count
          rows {
            studyLocusId
            studyId
            studyType
            chromosome
            position
            region
            beta
            zScore
            pValueMantissa
            pValueExponent
            standardError
            confidence
            finemappingMethod
            credibleSetIndex
            credibleSetlog10BF
            purityMeanR2
            purityMinR2
            study {
              id
              traitFromSource
              projectId
              pubmedId
              publicationFirstAuthor
              publicationDate
            }
            variant {
              id
              rsIds
            }
          }
        }
      }
    }
  `;
    const variables = filterNoneValues({
        variantId,
        studyTypes,
        pageIndex,
        pageSize,
    });
    return client.query(query, variables);
}
/**
 * Retrieve pharmacogenomic annotations for a variant.
 */
export async function getVariantPharmacogenomics(variantId, pageIndex = 0, pageSize = 10) {
    const client = getClient();
    const query = `
    query VariantPharmacogenomics($variantId: String!, $pageIndex: Int!, $pageSize: Int!) {
      variant(variantId: $variantId) {
        id
        rsIds
        pharmacogenomics(page: {index: $pageIndex, size: $pageSize}) {
          variantId
          variantRsId
          variantFunctionalConsequenceId
          targetFromSourceId
          genotypeId
          genotype
          genotypeAnnotationText
          phenotypeText
          phenotypeFromSourceId
          pgxCategory
          evidenceLevel
          datasourceId
          datatypeId
          studyId
          literature
          haplotypeId
          haplotypeFromSourceId
          isDirectTarget
          variantFunctionalConsequence {
            id
            label
          }
          target {
            id
            approvedSymbol
            approvedName
          }
          drugs {
            drugId
            drugFromSource
            drug {
              id
              name
              drugType
            }
          }
        }
      }
    }
  `;
    return client.query(query, { variantId, pageIndex, pageSize });
}
/**
 * Retrieve evidence strings linking a variant to targets or diseases.
 */
export async function getVariantEvidences(variantId, datasourceIds, size = 10, cursor) {
    const client = getClient();
    const query = `
    query VariantEvidences(
      $variantId: String!,
      $datasourceIds: [String!],
      $size: Int!,
      $cursor: String
    ) {
      variant(variantId: $variantId) {
        id
        rsIds
        evidences(
          datasourceIds: $datasourceIds,
          size: $size,
          cursor: $cursor
        ) {
          count
          cursor
          rows {
            id
            score
            datasourceId
            datatypeId
            variantRsId
            confidence
            literature
            studyId
            beta
            pValueMantissa
            pValueExponent
            oddsRatio
            oddsRatioConfidenceIntervalLower
            oddsRatioConfidenceIntervalUpper
            target {
              id
              approvedSymbol
            }
            disease {
              id
              name
            }
            variantFunctionalConsequence {
              id
              label
            }
          }
        }
      }
    }
  `;
    const variables = filterNoneValues({
        variantId,
        datasourceIds,
        size,
        cursor,
    });
    return client.query(query, variables);
}
/**
 * Retrieve enhancer-to-gene (E2G) predictions overlapping a variant.
 */
export async function getVariantIntervals(variantId, pageIndex = 0, pageSize = 10) {
    const client = getClient();
    const query = `
    query VariantIntervals($variantId: String!, $pageIndex: Int!, $pageSize: Int!) {
      variant(variantId: $variantId) {
        id
        rsIds
        chromosome
        position
        intervals(page: {index: $pageIndex, size: $pageSize}) {
          count
          rows {
            chromosome
            start
            end
            intervalType
            score
            resourceScore {
              name
              value
            }
            datasourceId
            pmid
            studyId
            distanceToTss
            biosampleName
            biosample {
              biosampleId
              biosampleName
              description
            }
            target {
              id
              approvedSymbol
              approvedName
              biotype
            }
          }
        }
      }
    }
  `;
    return client.query(query, { variantId, pageIndex, pageSize });
}
/**
 * Retrieve protein-level consequences for a variant.
 */
export async function getVariantProteinCoordinates(variantId, pageIndex = 0, pageSize = 10) {
    const client = getClient();
    const query = `
    query VariantProteinCoordinates($variantId: String!, $pageIndex: Int!, $pageSize: Int!) {
      variant(variantId: $variantId) {
        id
        rsIds
        chromosome
        position
        proteinCodingCoordinates(page: {index: $pageIndex, size: $pageSize}) {
          count
          rows {
            aminoAcidPosition
            referenceAminoAcid
            alternateAminoAcid
            variantEffect
            uniprotAccessions
            therapeuticAreas
            datasources {
              datasourceId
              datasourceNiceName
              datasourceCount
            }
            variantConsequences {
              id
              label
            }
            diseases {
              id
              name
            }
            target {
              id
              approvedSymbol
              approvedName
            }
            variant {
              id
              rsIds
            }
          }
        }
      }
    }
  `;
    return client.query(query, { variantId, pageIndex, pageSize });
}
//# sourceMappingURL=variant.js.map