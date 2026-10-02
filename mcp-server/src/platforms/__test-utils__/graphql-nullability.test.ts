import { buildSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import { collectNullablePaths } from './graphql-nullability.js';

const schema = buildSchema(`
  type Query {
    target(id: String!): Target
    search(q: String!): SearchResults!
  }

  type Target {
    id: String!
    approvedSymbol: String!
    synonyms: [String!]!
    tags: [String]
    location: Location!
  }

  type Location {
    chromosome: String!
    strand: Int
  }

  type Disease {
    id: String!
    description: String
  }

  type Study {
    id: String!
    traitFromSource: String
  }

  union Entity = Target | Disease | Study

  type SearchResults {
    total: Int!
    hits: [Hit!]!
  }

  type Hit {
    id: String!
    description: String
    object: Entity
  }
`);

describe('collectNullablePaths', () => {
  it('marks nullable fields and leaves non-null fields out', () => {
    const paths = collectNullablePaths(
      schema,
      `query { target(id: "x") { id approvedSymbol location { chromosome strand } } }`,
    );

    expect([...paths].sort()).toEqual(['$.target', '$.target.location.strand']);
  });

  it('distinguishes list nullability from item nullability', () => {
    const paths = collectNullablePaths(schema, `query { target(id: "x") { synonyms tags } }`);

    expect(paths.has('$.target.synonyms')).toBe(false);
    expect(paths.has('$.target.synonyms[]')).toBe(false);
    expect(paths.has('$.target.tags')).toBe(true);
    expect(paths.has('$.target.tags[]')).toBe(true);
  });

  it('uses aliases as response keys', () => {
    const paths = collectNullablePaths(
      schema,
      `query { braf: target(id: "x") { loc: location { strand } } }`,
    );

    expect(paths).toEqual(new Set(['$.braf', '$.braf.loc.strand']));
  });

  it('flattens union inline fragments onto one object path', () => {
    const paths = collectNullablePaths(
      schema,
      `query {
        search(q: "x") {
          total
          hits {
            id
            description
            object {
              __typename
              ... on Target { id approvedSymbol }
              ... on Disease { id description }
              ... on Study { id traitFromSource }
            }
          }
        }
      }`,
    );

    expect([...paths].sort()).toEqual([
      '$.search.hits[].description',
      '$.search.hits[].object',
      '$.search.hits[].object.description',
      '$.search.hits[].object.traitFromSource',
    ]);
  });

  it('follows named fragment spreads', () => {
    const paths = collectNullablePaths(
      schema,
      `query { target(id: "x") { ...Loc } }
       fragment Loc on Target { location { strand } }`,
    );

    expect(paths.has('$.target.location.strand')).toBe(true);
  });

  it('rejects operations that do not validate against the schema', () => {
    expect(() => collectNullablePaths(schema, `query { target(id: "x") { missing } }`))
      .toThrow(/invalid against schema/);
  });
});
