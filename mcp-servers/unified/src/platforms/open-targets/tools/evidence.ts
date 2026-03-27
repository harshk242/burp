// Evidence API Tools

import { getClient } from '../client.js';
import { filterNoneValues } from '../utils.js';

/**
 * Retrieve evidence strings linking a target to a disease.
 */
export async function getTargetDiseaseEvidence(
  ensemblId: string,
  efoId: string,
  datasourceIds?: string[],
  size: number = 10,
  cursor?: string
): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetDiseaseEvidences(
      $ensemblId: String!,
      $efoId: String!,
      $datasourceIds: [String!],
      $size: Int!,
      $cursor: String
    ) {
      target(ensemblId: $ensemblId) {
        evidences(
          efoIds: [$efoId],
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
            diseaseFromSource
            targetFromSourceId
            disease { id, name }
            target { id, approvedSymbol }
            literature
          }
        }
      }
    }
  `;
  const variables = filterNoneValues({
    ensemblId,
    efoId,
    datasourceIds,
    size,
    cursor,
  });
  return client.query(query, variables);
}

/**
 * Inspect evidence for biomarker annotations linking a target and disease.
 */
export async function getTargetDiseaseBiomarkers(
  ensemblId: string,
  efoId: string,
  size: number = 10,
  cursor?: string
): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetDiseaseBiomarkers(
      $ensemblId: String!,
      $efoId: String!,
      $size: Int!,
      $cursor: String
    ) {
      target(ensemblId: $ensemblId) {
        evidences(efoIds: [$efoId], size: $size, cursor: $cursor) {
          count
          cursor
          rows {
            id
            score
            datasourceId
            datatypeId
            biomarkerName
            disease { id, name }
            target { id, approvedSymbol }
          }
        }
      }
    }
  `;
  const variables = filterNoneValues({
    ensemblId,
    efoId,
    size,
    cursor,
  });
  return client.query(query, variables);
}
