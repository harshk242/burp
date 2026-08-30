// Disease API Tools

import { getClient } from '../client.js';
import { DISEASE_INFO_OPERATION } from './operations.js';

/**
 * Retrieve core metadata for an Open Targets disease entity.
 * Note: Despite the parameter name, this accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.)
 * Use search_entities to find the correct disease ID if unsure.
 */
export async function getDiseaseInfo(efoId: string): Promise<unknown> {
  const client = getClient();
  const result = await client.query(DISEASE_INFO_OPERATION, { efoId });

  // Check if disease was found and provide helpful error
  if (result && typeof result === 'object' && 'disease' in result && result.disease === null) {
    throw new Error(
      `Disease ID '${efoId}' not found. ` +
      `Please use the search_entities tool to find the correct disease ID. ` +
      `Example: search_entities({query_string: "disease name", entity_names: ["disease"]})`
    );
  }

  return result;
}

/**
 * List targets associated with a disease, including evidence scores.
 * Note: Despite the parameter name, this accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.)
 * Use search_entities to find the correct disease ID if unsure.
 */
export async function getDiseaseAssociatedTargets(
  efoId: string,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query DiseaseAssociatedTargets($efoId: String!, $pageIndex: Int!, $pageSize: Int!) {
      disease(efoId: $efoId) {
        id
        name
        associatedTargets(page: {index: $pageIndex, size: $pageSize}) {
          count
          rows {
            target {
              id
              approvedSymbol
              approvedName
              biotype
            }
            score
            datatypeScores {
              id
              score
            }
          }
        }
      }
    }
  `;
  const result = await client.query(query, { efoId, pageIndex, pageSize });

  // Check if disease was found and provide helpful error
  if (result && typeof result === 'object' && 'disease' in result && result.disease === null) {
    throw new Error(
      `Disease ID '${efoId}' not found. ` +
      `Please use the search_entities tool to find the correct disease ID. ` +
      `Example: search_entities({query_string: "disease name", entity_names: ["disease"]})`
    );
  }

  return result;
}

/**
 * Fetch HPO phenotype annotations linked to a disease.
 * Note: Despite the parameter name, this accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.)
 * Use search_entities to find the correct disease ID if unsure.
 */
export async function getDiseasePhenotypes(
  efoId: string,
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query DiseasePhenotypes($efoId: String!, $pageIndex: Int!, $pageSize: Int!) {
      disease(efoId: $efoId) {
        id
        name
        phenotypes(page: {index: $pageIndex, size: $pageSize}) {
          count
          rows {
            phenotypeHPO {
              id
              name
              description
            }
            phenotypeEFO {
              id
              name
            }
            evidence {
              aspect
              bioCuration
              diseaseFromSource
              diseaseFromSourceId
              evidenceType
              frequency
              modifiers { id name }
              onset { id name }
              qualifierNot
              references
              resource
              sex
            }
          }
        }
      }
    }
  `;
  const result = await client.query(query, { efoId, pageIndex, pageSize });

  // Check if disease was found and provide helpful error
  if (result && typeof result === 'object' && 'disease' in result && result.disease === null) {
    throw new Error(
      `Disease ID '${efoId}' not found. ` +
      `Please use the search_entities tool to find the correct disease ID. ` +
      `Example: search_entities({query_string: "disease name", entity_names: ["disease"]})`
    );
  }

  return result;
}

/**
 * List Open Targets Associated Research (OTAR) projects linked to a disease.
 * Note: Despite the parameter name, this accepts disease IDs from any ontology (EFO, MONDO, Orphanet, etc.)
 * Use search_entities to find the correct disease ID if unsure.
 */
export async function getDiseaseOtarProjects(efoId: string): Promise<unknown> {
  const client = getClient();
  const query = `
    query DiseaseOTARProjects($efoId: String!) {
      disease(efoId: $efoId) {
        id
        name
        otarProjects {
          otarCode
          projectName
          status
          reference
          integratesInPPP
        }
      }
    }
  `;
  const result = await client.query(query, { efoId });

  // Check if disease was found and provide helpful error
  if (result && typeof result === 'object' && 'disease' in result && result.disease === null) {
    throw new Error(
      `Disease ID '${efoId}' not found. ` +
      `Please use the search_entities tool to find the correct disease ID. ` +
      `Example: search_entities({query_string: "disease name", entity_names: ["disease"]})`
    );
  }

  return result;
}
