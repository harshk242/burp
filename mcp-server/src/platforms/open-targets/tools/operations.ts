/** Complete GraphQL operations shared by tools and live API contracts. */

export const DISEASE_INFO_OPERATION = `
  query DiseaseInfo($efoId: String!) {
    disease(efoId: $efoId) {
      id
      name
      description
      synonyms {
        relation
        terms
      }
      therapeuticAreas {
        id
        name
      }
      dbXRefs
    }
  }
`;

export const DEFAULT_SEARCH_ENTITY_NAMES = ['target', 'disease', 'drug', 'variant', 'study'];

export const SEARCH_ENTITIES_OPERATION = `
  query SearchEntities($queryString: String!, $entityNames: [String!], $pageIndex: Int!, $pageSize: Int!) {
    search(
      queryString: $queryString,
      entityNames: $entityNames,
      page: {index: $pageIndex, size: $pageSize}
    ) {
      total
      hits {
        id
        entity
        name
        description
        score
        highlights
        object {
          __typename
          ... on Target { id approvedSymbol approvedName biotype }
          ... on Disease { id name description therapeuticAreas { id name } }
          ... on Drug { id name drugType maximumClinicalStage }
          ... on Variant { id chromosome position rsIds }
          ... on Study { id studyType traitFromSource }
        }
      }
    }
  }
`;
