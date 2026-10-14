import { getClient } from '../client.js';
import { filterNoneValues } from '../utils.js';

export async function getStudyInfo(studyId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query StudyInfo($studyId: String!) {
      study(studyId: $studyId) {
        id
        studyType
        projectId
        traitFromSource
        condition
        pubmedId
        publicationTitle
        publicationJournal
        publicationFirstAuthor
        publicationDate
        cohorts
        hasSumstats
        summarystatsLocation
        initialSampleSize
        nSamples
        nCases
        nControls
        analysisFlags
        qualityControls
        ldPopulationStructure {
          ldPopulation
          relativeSampleSize
        }
        discoverySamples {
          ancestry
          sampleSize
        }
        replicationSamples {
          ancestry
          sampleSize
        }
        sumstatQCValues {
          QCCheckName
          QCCheckValue
        }
        target {
          id
          approvedSymbol
        }
        biosample {
          biosampleId
          biosampleName
          description
        }
        diseases {
          id
          name
          therapeuticAreas {
            id
            name
          }
        }
        backgroundTraits {
          id
          name
        }
      }
    }
  `;
  return client.query(query, { studyId });
}

export async function getStudiesByDisease(
  diseaseIds: string[],
  enableIndirect: boolean = false,
  studyId?: string,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query StudiesByDisease(
      $diseaseIds: [String!],
      $enableIndirect: Boolean,
      $studyId: String,
      $pageIndex: Int!,
      $pageSize: Int!
    ) {
      studies(
        diseaseIds: $diseaseIds,
        enableIndirect: $enableIndirect,
        studyId: $studyId,
        page: {index: $pageIndex, size: $pageSize}
      ) {
        count
        rows {
          id
          studyType
          traitFromSource
          pubmedId
          publicationFirstAuthor
          publicationDate
          nSamples
          nCases
          nControls
          cohorts
          analysisFlags
          diseases {
            id
            name
          }
          target {
            id
            approvedSymbol
          }
        }
      }
    }
  `;
  const variables = filterNoneValues({
    diseaseIds,
    enableIndirect,
    studyId,
    pageIndex,
    pageSize,
  });
  return client.query(query, variables);
}

export async function getStudyCredibleSets(
  studyId: string,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query StudyCredibleSets($studyId: String!, $pageIndex: Int!, $pageSize: Int!) {
      study(studyId: $studyId) {
        id
        studyType
        traitFromSource
        credibleSets(page: {index: $pageIndex, size: $pageSize}) {
          count
          rows {
            studyLocusId
            studyId
            chromosome
            position
            region
            locusStart
            locusEnd
            credibleSetIndex
            credibleSetlog10BF
            finemappingMethod
            purityMeanR2
            purityMinR2
            zScore
            beta
            standardError
            pValueMantissa
            pValueExponent
            effectAlleleFrequencyFromSource
            confidence
            variant {
              id
              rsIds
              referenceAllele
              alternateAllele
            }
            locus(page: {index: 0, size: 5}) {
              count
              rows {
                is95CredibleSet
                is99CredibleSet
                posteriorProbability
                logBF
                pValueMantissa
                pValueExponent
                beta
                standardError
                r2Overall
                variant {
                  id
                  rsIds
                }
              }
            }
          }
        }
      }
    }
  `;
  return client.query(query, { studyId, pageIndex, pageSize });
}

export async function getCredibleSetById(studyLocusId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query CredibleSetById($studyLocusId: String!) {
      credibleSet(studyLocusId: $studyLocusId) {
        studyLocusId
        studyId
        studyType
        chromosome
        position
        region
        locusStart
        locusEnd
        credibleSetIndex
        credibleSetlog10BF
        finemappingMethod
        confidence
        purityMeanR2
        purityMinR2
        zScore
        beta
        standardError
        pValueMantissa
        pValueExponent
        effectAlleleFrequencyFromSource
        qtlGeneId
        isTransQtl
        study {
          id
          traitFromSource
          pubmedId
          publicationFirstAuthor
        }
        variant {
          id
          rsIds
          referenceAllele
          alternateAllele
          mostSevereConsequence {
            id
            label
          }
        }
        l2GPredictions(page: {index: 0, size: 10}) {
          count
          rows {
            studyLocusId
            score
            shapBaseValue
            target {
              id
              approvedSymbol
            }
            features {
              name
              value
              shapValue
            }
          }
        }
      }
    }
  `;
  return client.query(query, { studyLocusId });
}

export async function getCredibleSetColocalisation(
  studyLocusId: string,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query CredibleSetColocalisation($studyLocusId: String!, $pageIndex: Int!, $pageSize: Int!) {
      credibleSet(studyLocusId: $studyLocusId) {
        studyLocusId
        studyId
        studyType
        chromosome
        position
        variant {
          id
          rsIds
        }
        study {
          id
          traitFromSource
        }
        colocalisation(page: {index: $pageIndex, size: $pageSize}) {
          count
          rows {
            leftStudyLocusId
            rightStudyLocusId
            rightStudyType
            chromosome
            colocalisationMethod
            numberColocalisingVariants
            h3
            h4
            clpp
            betaRatioSignAverage
            otherStudyLocus {
              studyLocusId
              studyId
              studyType
              variant {
                id
                rsIds
              }
              study {
                id
                traitFromSource
                target {
                  id
                  approvedSymbol
                }
                biosample {
                  biosampleId
                  biosampleName
                }
              }
            }
          }
        }
      }
    }
  `;
  return client.query(query, { studyLocusId, pageIndex, pageSize });
}

export async function getCredibleSets(
  studyLocusIds?: string[],
  studyIds?: string[],
  variantIds?: string[],
  studyTypes?: string[],
  regions?: string[],
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query CredibleSets(
      $studyLocusIds: [String!],
      $studyIds: [String!],
      $variantIds: [String!],
      $studyTypes: [StudyTypeEnum!],
      $regions: [String!],
      $pageIndex: Int!,
      $pageSize: Int!
    ) {
      credibleSets(
        studyLocusIds: $studyLocusIds,
        studyIds: $studyIds,
        variantIds: $variantIds,
        studyTypes: $studyTypes,
        regions: $regions,
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
          locusStart
          locusEnd
          beta
          zScore
          pValueMantissa
          pValueExponent
          standardError
          credibleSetIndex
          credibleSetlog10BF
          finemappingMethod
          confidence
          purityMeanR2
          purityMinR2
          effectAlleleFrequencyFromSource
          sampleSize
          qualityControls
          variant {
            id
            rsIds
            chromosome
            position
          }
          study {
            id
            traitFromSource
            studyType
            pubmedId
            publicationFirstAuthor
            target {
              id
              approvedSymbol
            }
          }
        }
      }
    }
  `;
  const variables = filterNoneValues({
    studyLocusIds,
    studyIds,
    variantIds,
    studyTypes,
    regions,
    pageIndex,
    pageSize,
  });
  return client.query(query, variables);
}
