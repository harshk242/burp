// Target Identity API Tools

import { getClient } from '../../client.js';

/**
 * Retrieve core identity details for a target gene.
 */
export async function getTargetInfo(ensemblId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query TargetInfo($ensemblId: String!) {
      target(ensemblId: $ensemblId) {
        id
        approvedSymbol
        approvedName
        biotype
        functionDescriptions
        synonyms { label, source }
        genomicLocation { chromosome, start, end, strand }
        proteinIds { id, source }
      }
    }
  `;
  return client.query(query, { ensemblId });
}

/**
 * Return ChEMBL target class annotations for a gene.
 */
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

/**
 * List alternate gene symbols and database cross-references for a target.
 */
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
