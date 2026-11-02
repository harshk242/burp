import { getClient } from '../client.js';

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
