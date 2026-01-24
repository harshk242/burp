// Target Associations API Tools
import { getClient } from '../../client.js';
import { filterNoneValues, truncateArray } from '../../utils.js';
/**
 * List diseases linked to a target with association scores.
 */
export async function getTargetAssociatedDiseases(ensemblId, pageIndex = 0, pageSize = 10) {
    const client = getClient();
    const query = `
    query TargetAssociatedDiseases($ensemblId: String!, $pageIndex: Int!, $pageSize: Int!) {
      target(ensemblId: $ensemblId) {
        associatedDiseases(page: {index: $pageIndex, size: $pageSize}) {
          count
          rows {
            disease { id, name, description, therapeuticAreas { id, name } }
            score
            datatypeScores { id, score }
          }
        }
      }
    }
  `;
    return client.query(query, { ensemblId, pageIndex, pageSize });
}
/**
 * Return compounds with known activity on the target.
 */
export async function getTargetKnownDrugs(ensemblId, _pageIndex = 0, _pageSize = 10) {
    const client = getClient();
    const query = `
    query TargetKnownDrugs($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        knownDrugs {
          count
          rows {
            drugId
            targetId
            drug {
              id
              name
              drugType
              maximumClinicalTrialPhase
              isApproved
              description
            }
            mechanismOfAction
            disease {
              id
              name
            }
            phase
            status
            urls {
              name
              url
            }
          }
        }
      }
    }
  `;
    return client.query(query, { ensemblId });
}
/**
 * Return literature co-occurrence records for a target.
 */
export async function getTargetLiteratureOccurrences(ensemblId, additionalEntityIds, startYear, endYear, startMonth, endMonth, cursor, size = 20) {
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
    // Client-side trimming since API no longer paginates server-side
    if (size > 0 && result?.target?.literatureOcurrences?.rows) {
        result.target.literatureOcurrences.rows = truncateArray(result.target.literatureOcurrences.rows, size);
    }
    return result;
}
//# sourceMappingURL=associations.js.map