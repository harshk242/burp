// Target Safety API Tools
import { getClient } from '../../client.js';
/**
 * Retrieve documented safety liabilities for a target.
 */
export async function getTargetSafetyInformation(ensemblId) {
    const client = getClient();
    const query = `
    query TargetSafety($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        safetyLiabilities {
          event
          eventId
          effects {
            direction
            dosing
          }
          datasource
        }
      }
    }
  `;
    return client.query(query, { ensemblId });
}
/**
 * Return tractability assessments across modalities for a target.
 */
export async function getTargetTractability(ensemblId) {
    const client = getClient();
    const query = `
    query TargetTractability($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        tractability {
          modality
          value
          label
        }
      }
    }
  `;
    return client.query(query, { ensemblId });
}
/**
 * List available chemical probes and their quality metrics.
 */
export async function getTargetChemicalProbes(ensemblId) {
    const client = getClient();
    const query = `
    query TargetChemicalProbes($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        chemicalProbes {
          id
          control
          drugId
          isHighQuality
          mechanismOfAction
          origin
          probesDrugsScore
          probeMinerScore
          scoreInCells
          scoreInOrganisms
          targetFromSourceId
          urls { niceName, url }
        }
      }
    }
  `;
    return client.query(query, { ensemblId });
}
/**
 * Fetch Target Enabling Package (TEP) information for a gene.
 */
export async function getTargetTep(ensemblId) {
    const client = getClient();
    const query = `
    query TargetTEP($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        tep {
          name
          therapeuticArea
          uri
        }
      }
    }
  `;
    return client.query(query, { ensemblId });
}
/**
 * Return target prioritisation scores compiled across data sources.
 */
export async function getTargetPrioritization(ensemblId) {
    const client = getClient();
    const query = `
    query TargetPrioritisation($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        prioritisation {
          items {
            key
            value
          }
        }
      }
    }
  `;
    return client.query(query, { ensemblId });
}
//# sourceMappingURL=safety.js.map