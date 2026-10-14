import { getClient } from '../../client.js';

export async function getDrugAdverseEvents(
  chemblId: string,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query DrugAdverseEvents($chemblId: String!, $pageIndex: Int!, $pageSize: Int!) {
      drug(chemblId: $chemblId) {
        id
        name
        adverseEvents(page: {index: $pageIndex, size: $pageSize}) {
          count
          criticalValue
          rows {
            meddraCode
            name
            count
            logLR
          }
        }
      }
    }
  `;
  return client.query(query, { chemblId, pageIndex, pageSize });
}

export async function getDrugPharmacovigilance(chemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query DrugPharmacovigilance($chemblId: String!) {
      drug(chemblId: $chemblId) {
        id
        name
        adverseEvents(page: {index: 0, size: 20}) {
          count
          criticalValue
          rows {
            meddraCode
            name
            count
            logLR
          }
        }
      }
    }
  `;
  return client.query(query, { chemblId });
}

export async function getDrugWarnings(chemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query DrugWarnings($chemblId: String!) {
      drug(chemblId: $chemblId) {
        id
        name
        drugWarnings {
          warningType
          description
          toxicityClass
          country
          year
          efoId
          efoTerm
          efoIdForWarningClass
          references {
            id
            source
            url
          }
          chemblIds
        }
      }
    }
  `;
  return client.query(query, { chemblId });
}
