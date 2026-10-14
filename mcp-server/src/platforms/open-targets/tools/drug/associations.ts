import { getClient } from '../../client.js';

export async function getDrugLinkedDiseases(chemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query DrugLinkedDiseases($chemblId: String!) {
      drug(chemblId: $chemblId) {
        id
        name
        indications {
          count
          rows {
            maxClinicalStage
            disease {
              id
              name
              description
              therapeuticAreas {
                id
                name
              }
            }
          }
        }
      }
    }
  `;
  return client.query(query, { chemblId });
}

export async function getDrugLinkedTargets(chemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query DrugLinkedTargets($chemblId: String!) {
      drug(chemblId: $chemblId) {
        id
        name
        mechanismsOfAction {
          rows {
            mechanismOfAction
            targetName
            actionType
            targets {
              id
              approvedSymbol
            }
          }
        }
      }
    }
  `;
  return client.query(query, { chemblId });
}
