import { getClient } from '../../client.js';
import { filterNoneValues, truncateArray } from '../../utils.js';
import { TARGET_ASSOCIATED_DISEASES_OPERATION } from './operations.js';

export async function getTargetAssociatedDiseases(
  ensemblId: string,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  return client.query(TARGET_ASSOCIATED_DISEASES_OPERATION, { ensemblId, pageIndex, pageSize });
}

export async function getTargetKnownDrugs(
  ensemblId: string,
  _pageIndex: number = 0,
  _pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetKnownDrugs($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        drugAndClinicalCandidates {
          count
          rows {
            id
            maxClinicalStage
            drug {
              id
              name
              drugType
              maximumClinicalStage
              description
            }
            diseases {
              disease {
                id
                name
              }
            }
          }
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

interface LiteratureResult {
  target?: {
    literatureOcurrences?: {
      rows?: unknown[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function getTargetLiteratureOccurrences(
  ensemblId: string,
  additionalEntityIds?: string[],
  startYear?: number,
  endYear?: number,
  startMonth?: number,
  endMonth?: number,
  cursor?: string,
  size: number = 20
): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetLiteratureOcurrences(
      $ensemblId: String!,
      $additionalIds: [String!],
      $startYear: Int,
      $startMonth: Int,
      $endYear: Int,
      $endMonth: Int,
      $cursor: String
    ) {
      target(ensemblId: $ensemblId) {
        literatureOcurrences(
          additionalIds: $additionalIds,
          startYear: $startYear,
          startMonth: $startMonth,
          endYear: $endYear,
          endMonth: $endMonth,
          cursor: $cursor
        ) {
          count
          filteredCount
          earliestPubYear
          cursor
          rows {
            pmid
            pmcid
            publicationDate
          }
        }
      }
    }
  `;

  const variables = filterNoneValues({
    ensemblId,
    additionalIds: additionalEntityIds,
    startYear,
    startMonth,
    endYear,
    endMonth,
    cursor,
  });

  const result = await client.query<LiteratureResult>(query, variables);

  if (size > 0 && result?.target?.literatureOcurrences?.rows) {
    return {
      ...result,
      target: {
        ...result.target,
        literatureOcurrences: {
          ...result.target.literatureOcurrences,
          rows: truncateArray(result.target.literatureOcurrences.rows, size),
        },
      },
    };
  }

  return result;
}
