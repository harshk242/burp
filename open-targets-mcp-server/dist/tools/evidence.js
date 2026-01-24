// Evidence API Tools
import { getClient } from '../client.js';
import { filterNoneValues } from '../utils.js';
/**
 * Retrieve evidence strings linking a target to a disease.
 */
export async function getTargetDiseaseEvidence(ensemblId, efoId, datasourceIds, size = 10, cursor) {
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
export async function getTargetDiseaseBiomarkers(ensemblId, efoId, size = 10, cursor) {
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
//# sourceMappingURL=evidence.js.map