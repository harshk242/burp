// Drug Safety API Tools

import { getClient } from '../../client.js';

/**
 * Retrieve adverse event signals associated with a drug.
 */
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

/**
 * Summarise high-level pharmacovigilance data for a drug.
 */
export async function getDrugPharmacovigilance(chemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query DrugPharmacovigilance($chemblId: String!) {
      drug(chemblId: $chemblId) {
        id
        name
        isApproved
        hasBeenWithdrawn
        blackBoxWarning
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

/**
 * Fetch detailed regulatory warnings, including withdrawals and boxed labels.
 */
export async function getDrugWarnings(chemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query DrugWarnings($chemblId: String!) {
      drug(chemblId: $chemblId) {
        id
        name
        hasBeenWithdrawn
        blackBoxWarning
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
