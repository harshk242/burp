// Drug Identity API Tools
import { getClient } from '../../client.js';
/**
 * Fetch identity, indication, and mechanism data for a drug.
 */
export async function getDrugInfo(chemblId) {
    const client = getClient();
    const query = `
    query DrugInfo($chemblId: String!) {
      drug(chemblId: $chemblId) {
        id
        name
        synonyms
        tradeNames
        drugType
        description
        isApproved
        hasBeenWithdrawn
        blackBoxWarning
        yearOfFirstApproval
        maximumClinicalTrialPhase
        mechanismsOfAction {
          rows {
            mechanismOfAction
            targetName
            targets {
              id
              approvedSymbol
            }
            actionType
            references {
              source
              ids
              urls
            }
          }
        }
        indications {
          rows {
            disease {
              id
              name
              therapeuticAreas { id, name }
            }
            maxPhaseForIndication
            references {
              source
              ids
            }
          }
          count
        }
        linkedTargets {
          rows {
            id
            approvedSymbol
            biotype
          }
          count
        }
      }
    }
  `;
    return client.query(query, { chemblId });
}
/**
 * Retrieve cross-database identifiers related to a drug.
 */
export async function getDrugCrossReferences(chemblId) {
    const client = getClient();
    const query = `
    query DrugCrossReferences($chemblId: String!) {
      drug(chemblId: $chemblId) {
        id
        name
        synonyms
        crossReferences {
          source
          ids
        }
        parentMolecule {
          id
          name
        }
        childMolecules {
          id
          name
          drugType
        }
      }
    }
  `;
    return client.query(query, { chemblId });
}
//# sourceMappingURL=identity.js.map