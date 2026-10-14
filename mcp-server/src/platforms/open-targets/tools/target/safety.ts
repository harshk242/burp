import { getClient } from '../../client.js';

export async function getTargetSafetyInformation(ensemblId: string): Promise<unknown> {
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

export async function getTargetTractability(ensemblId: string): Promise<unknown> {
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

export async function getTargetChemicalProbes(ensemblId: string): Promise<unknown> {
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

export async function getTargetTep(ensemblId: string): Promise<unknown> {
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

export async function getTargetPrioritization(ensemblId: string): Promise<unknown> {
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
