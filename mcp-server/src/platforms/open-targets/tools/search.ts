import type * as Fuzzball from 'fuzzball';
import { getClient } from '../client.js';
import { filterNoneValues } from '../utils.js';
import { optNumber, optString, path, recordArray } from '../../../shared/json.js';
import { mapIds } from './meta.js';
import {
  DEFAULT_SEARCH_ENTITY_NAMES,
  SEARCH_ENTITIES_OPERATION,
} from './operations.js';

let fuzzball: typeof Fuzzball | null = null;
try {
  fuzzball = await import('fuzzball');
} catch {
  console.warn("'fuzzball' library not found. Suggestions will not work.");
}

async function searchDirect(
  queryString: string,
  entityNames?: string[],
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const client = getClient();
  const variables = {
    queryString,
    entityNames: entityNames || DEFAULT_SEARCH_ENTITY_NAMES,
    pageIndex,
    pageSize,
  };
  return client.query(SEARCH_ENTITIES_OPERATION, variables);
}

interface SearchHit {
  id: string;
  entity: string;
  name: string;
  approvedSymbol?: string | undefined;
}

/** The hits of a `search` response that carry an id; other hits are skipped. */
function searchHits(result: unknown): SearchHit[] {
  return recordArray(path(result, 'search', 'hits')).flatMap((hit) => {
    const id = optString(hit.id);
    if (id === undefined) return [];
    return [{
      id,
      entity: optString(hit.entity) ?? '',
      name: optString(hit.name) ?? '',
      approvedSymbol: optString(path(hit, 'object', 'approvedSymbol')),
    }];
  });
}

interface MappedHit {
  id: string;
  name?: string | undefined;
  score?: number | undefined;
}

/** The hits of the first `mapIds` mapping. */
function firstMappingHits(result: unknown): MappedHit[] {
  const [first] = recordArray(path(result, 'mapIds', 'mappings'));
  return recordArray(first?.hits).flatMap((hit) => {
    const id = optString(hit.id);
    return id === undefined ? [] : [{ id, name: optString(hit.name), score: optNumber(hit.score) }];
  });
}

export async function searchEntities(
  queryString: string,
  entityNames?: string[],
  pageIndex: number = 0,
  pageSize: number = 10
): Promise<unknown> {
  const [directResults, mappedResults] = await Promise.all([
    searchDirect(queryString, entityNames, pageIndex, pageSize),
    mapIds([queryString], entityNames),
  ]);

  let bestMappedHit: MappedHit | null = null;
  for (const hit of firstMappingHits(mappedResults)) {
    if (!bestMappedHit || (hit.score || 0) > (bestMappedHit.score || 0)) bestMappedHit = hit;
  }

  const directHits = searchHits(directResults);
  const directTopHitId = directHits[0]?.id;

  if (bestMappedHit &&
      bestMappedHit.id !== directTopHitId &&
      bestMappedHit.score === 1.0 &&
      directHits.length) {
    console.error(
      `[INFO] Resolving '${queryString}' to canonical match: '${bestMappedHit.name}' (${bestMappedHit.id})`
    );
    try {
      const canonicalResults = await searchDirect(bestMappedHit.id, entityNames, pageIndex, pageSize);
      if (searchHits(canonicalResults).length) {
        return canonicalResults;
      }
    } catch (error) {
      console.warn(`Failed to search with canonical ID ${bestMappedHit.id}, falling back to direct results:`, error);
    }
  }

  return directResults;
}

interface FuzzyChoice {
  id: string;
  entity: string;
}

export async function searchSuggestions(
  queryPrefix: string,
  entityNames?: string[],
  maxSuggestions: number = 10
): Promise<unknown> {
  if (!fuzzball) {
    return { error: "'fuzzball' library is required for suggestions." };
  }

  if (queryPrefix.length < 3) {
    return { suggestions: [], message: 'Query prefix must be at least 3 characters long.' };
  }

  const hits = searchHits(await searchDirect(queryPrefix, entityNames, 0, 50));

  if (!hits.length) {
    return { suggestions: [] };
  }

  const choices: Record<string, FuzzyChoice> = {};
  for (const hit of hits) {
    const name = hit.name;
    const symbol = hit.approvedSymbol;
    if (name && !(name in choices)) {
      choices[name] = { id: hit.id, entity: hit.entity };
    }
    if (symbol && !(symbol in choices)) {
      choices[symbol] = { id: hit.id, entity: hit.entity };
    }
  }

  const choiceKeys = Object.keys(choices);
  const extracted = fuzzball.extract(queryPrefix, choiceKeys, {
    scorer: fuzzball.ratio,
    cutoff: 70,
    limit: maxSuggestions,
  });

  const suggestions = extracted.flatMap(([label, score]: [string, number, number]) => {
    const choice = choices[label];
    return choice ? [{ label, score, id: choice.id, entity: choice.entity }] : [];
  });

  return { suggestions };
}

export async function getSimilarTargets(
  entityId: string,
  threshold: number = 0.5,
  size: number = 10
): Promise<unknown> {
  const client = getClient();
  const query = `
    query SimilarTargets($entityId: String!, $threshold: Float, $size: Int!) {
      target(ensemblId: $entityId) {
        id
        approvedSymbol
        similarEntities(threshold: $threshold, size: $size) {
          score
          object {
            __typename
            ... on Target { id, approvedSymbol, approvedName }
          }
        }
      }
    }
  `;
  return client.query(query, { entityId, threshold, size });
}

export async function searchFacets(
  queryString?: string,
  categoryId?: string,
  entityNames?: string[],
  pageIndex: number = 0,
  pageSize: number = 20
): Promise<unknown> {
  const client = getClient();
  const query = `
    query SearchFacets(
      $queryString: String!, $categoryId: String, $entityNames: [String!], $pageIndex: Int!, $pageSize: Int!
    ) {
      facets(
        queryString: $queryString, category: $categoryId, entityNames: $entityNames, page: {index: $pageIndex, size: $pageSize}
      ) {
        total
        categories { name, total }
        hits { id, label, category, score, entityIds, datasourceId, highlights }
      }
    }
  `;
  const variables = filterNoneValues({
    queryString: queryString || '*',
    categoryId,
    entityNames: entityNames || ['target', 'disease', 'drug', 'variant', 'study'],
    pageIndex,
    pageSize,
  });
  return client.query(query, variables);
}
