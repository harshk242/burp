// Meta API Tools

import { getClient } from '../client.js';

/**
 * Return Open Targets Platform release metadata.
 */
export async function getApiMetadata(): Promise<unknown> {
  const client = getClient();
  const query = `
    query ApiMetadata {
      meta {
        name
        apiVersion {
          x
          y
          z
        }
        dataVersion {
          year
          month
          iteration
        }
      }
    }
  `;
  return client.query(query);
}

/**
 * List sources contributing target–disease association evidence.
 */
export async function getAssociationDatasources(): Promise<unknown> {
  const client = getClient();
  const query = `
    query AssociationDatasources {
      associationDatasources {
        datasource
        datatype
      }
    }
  `;
  return client.query(query);
}

/**
 * Enumerate interaction databases integrated into Open Targets.
 */
export async function getInteractionResources(): Promise<unknown> {
  const client = getClient();
  const query = `
    query InteractionResources {
      interactionResources {
        sourceDatabase
        databaseVersion
      }
    }
  `;
  return client.query(query);
}

/**
 * Resolve Gene Ontology identifiers to human-readable labels.
 */
export async function getGeneOntologyTerms(goIds: string[]): Promise<unknown> {
  const client = getClient();
  const query = `
    query GeneOntologyTerms($goIds: [String!]!) {
      geneOntologyTerms(goIds: $goIds) {
        id
        name
      }
    }
  `;
  return client.query(query, { goIds });
}

/**
 * Map free-text terms to canonical Open Targets identifiers.
 */
export async function mapIds(
  queryTerms: string[],
  entityNames?: string[]
): Promise<unknown> {
  const client = getClient();
  const query = `
    query MapIds($queryTerms: [String!]!, $entityNames: [String!]) {
      mapIds(queryTerms: $queryTerms, entityNames: $entityNames) {
        total
        mappings {
          term
          hits {
            id
            name
            entity
            category
            multiplier
            prefixes
            score
            object {
              __typename
              ... on Target {
                id
                approvedSymbol
                approvedName
              }
              ... on Disease {
                id
                name
                description
              }
              ... on Drug {
                id
                name
                drugType
              }
              ... on Variant {
                id
                chromosome
                position
                rsIds
              }
              ... on Study {
                id
                studyType
                traitFromSource
              }
            }
          }
        }
        aggregations {
          total
          entities {
            name
            total
            categories {
              name
              total
            }
          }
        }
      }
    }
  `;
  const variables = {
    queryTerms,
    entityNames: entityNames || ['target', 'disease', 'drug', 'variant', 'study'],
  };
  return client.query(query, variables);
}
