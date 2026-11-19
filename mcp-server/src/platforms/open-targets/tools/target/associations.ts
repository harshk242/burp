import { getClient } from '../../client.js';
import { filterNoneValues, truncateArray } from '../../utils.js';
import { asArray, asRecord, optRecord, path } from '../../../../shared/json.js';
import { TARGET_ASSOCIATED_DISEASES_OPERATION } from './operations.js';

export async function getTargetAssociatedDiseases(
  ensemblId: string,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  return client.query(TARGET_ASSOCIATED_DISEASES_OPERATION, { ensemblId, pageIndex, pageSize });
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

  const result = await client.query(query, variables);
  const target = optRecord(path(result, 'target'));
  const literature = optRecord(target?.literatureOcurrences);
  const rows = literature?.rows;

  if (size > 0 && target && literature && Array.isArray(rows)) {
    return {
      ...asRecord(result),
      target: {
        ...target,
        literatureOcurrences: {
          ...literature,
          rows: truncateArray(asArray(rows), size),
        },
      },
    };
  }

  return result;
}
