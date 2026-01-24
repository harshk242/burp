// Search API Tools
import { getClient } from '../client.js';
import { filterNoneValues } from '../utils.js';
import { mapIds } from './meta.js';
// Optional fuzzy matching support
let fuzzball = null;
try {
    // fuzzball exports named exports (extract, ratio, etc.), not a default export
    fuzzball = await import('fuzzball');
}
catch {
    console.warn("'fuzzball' library not found. Suggestions will not work.");
}
/**
 * Internal helper for direct search.
 */
async function searchDirect(queryString, entityNames, pageIndex = 0, pageSize = 10) {
    const client = getClient();
    const query = `
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
            ... on Target { id, approvedSymbol, approvedName, biotype }
            ... on Disease { id, name, description, therapeuticAreas { id, name } }
            ... on Drug { id, name, drugType, maximumClinicalTrialPhase, isApproved }
            ... on Variant { id, chromosome, position, rsIds }
            ... on Study { id, studyType, traitFromSource }
          }
        }
      }
    }
  `;
    const variables = {
        queryString,
        entityNames: entityNames || ['target', 'disease', 'drug', 'variant', 'study'],
        pageIndex,
        pageSize,
    };
    return client.query(query, variables);
}
/**
 * Search Open Targets entities and resolve synonyms to canonical IDs.
 */
export async function searchEntities(queryString, entityNames, pageIndex = 0, pageSize = 10) {
    // Run direct search and ID mapping in parallel
    const [directResults, mappedResults] = await Promise.all([
        searchDirect(queryString, entityNames, pageIndex, pageSize),
        mapIds([queryString], entityNames),
    ]);
    // Find best mapped hit
    let bestMappedHit = null;
    const mappings = mappedResults?.mapIds?.mappings || [];
    if (mappings.length > 0 && mappings[0]?.hits?.length) {
        bestMappedHit = mappings[0].hits.reduce((best, hit) => (hit.score || 0) > (best?.score || 0) ? hit : best, mappings[0].hits[0]);
    }
    const directTopHitId = directResults?.search?.hits?.[0]?.id;
    // Only re-search if:
    // 1. We have a mapped hit with a different ID
    // 2. The mapped hit has a perfect score (1.0)
    // 3. The direct search returned results (to avoid breaking on empty results)
    if (bestMappedHit &&
        bestMappedHit.id !== directTopHitId &&
        bestMappedHit.score === 1.0 &&
        directResults?.search?.hits?.length) {
        console.log(`Resolving '${queryString}' to canonical match: '${bestMappedHit.name}' (${bestMappedHit.id})`);
        try {
            // Try to re-search with the canonical ID
            const canonicalResults = await searchDirect(bestMappedHit.id, entityNames, pageIndex, pageSize);
            // Only use the canonical results if they actually returned data
            if (canonicalResults?.search?.hits?.length) {
                return canonicalResults;
            }
        }
        catch (error) {
            console.warn(`Failed to search with canonical ID ${bestMappedHit.id}, falling back to direct results:`, error);
        }
    }
    return directResults;
}
/**
 * Return autocomplete suggestions for partially typed queries.
 */
export async function searchSuggestions(queryPrefix, entityNames, maxSuggestions = 10) {
    if (!fuzzball) {
        return { error: "'fuzzball' library is required for suggestions." };
    }
    if (queryPrefix.length < 3) {
        return { suggestions: [], message: 'Query prefix must be at least 3 characters long.' };
    }
    const candidatesResult = await searchDirect(queryPrefix, entityNames, 0, 50);
    if (!candidatesResult?.search?.hits?.length) {
        return { suggestions: [] };
    }
    // Build choices map
    const choices = {};
    for (const hit of candidatesResult.search.hits) {
        const name = hit.name;
        const symbol = hit.object?.approvedSymbol;
        if (name && !(name in choices)) {
            choices[name] = { id: hit.id, entity: hit.entity };
        }
        if (symbol && !(symbol in choices)) {
            choices[symbol] = { id: hit.id, entity: hit.entity };
        }
    }
    // Fuzzy match
    const choiceKeys = Object.keys(choices);
    const extracted = fuzzball.extract(queryPrefix, choiceKeys, {
        scorer: fuzzball.ratio,
        cutoff: 70,
        limit: maxSuggestions,
    });
    const suggestions = extracted.map((item) => ({
        label: item[0],
        score: item[1],
        id: choices[item[0]].id,
        entity: choices[item[0]].entity,
    }));
    return { suggestions };
}
/**
 * Identify targets with similar association profiles to the seed target.
 */
export async function getSimilarTargets(entityId, threshold = 0.5, size = 10) {
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
/**
 * Return facet counts to help filter search results.
 */
export async function searchFacets(queryString, categoryId, entityNames, pageIndex = 0, pageSize = 20) {
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
//# sourceMappingURL=search.js.map