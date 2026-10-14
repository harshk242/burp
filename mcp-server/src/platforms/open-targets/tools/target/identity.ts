import { getClient } from '../../client.js';
import { TARGET_INFO_OPERATION } from './operations.js';

export async function getTargetInfo(ensemblId: string): Promise<unknown> {
  const client = getClient();
  return client.query(TARGET_INFO_OPERATION, { ensemblId });
}

export async function getTargetClass(ensemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetClass($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        targetClass {
          id
          label
          level
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

export async function getTargetAlternativeGenes(ensemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetAlternativeGenes($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        alternativeGenes
        transcriptIds
        dbXrefs {
          id
          source
        }
      }
    }
  `;
  return client.query(query, { ensemblId });
}
