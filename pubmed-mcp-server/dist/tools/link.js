// Link/relationship tools for PubMed MCP Server
import { getClient } from '../client.js';
import { formatPmid } from '../utils.js';
/**
 * Find related articles for a given PMID
 */
export async function findRelatedArticles(pmid, maxResults = 20) {
    const client = getClient();
    const formattedId = formatPmid(pmid);
    const relatedIds = await client.findRelatedArticles(formattedId);
    // Limit results
    const limitedIds = relatedIds.slice(0, maxResults);
    return {
        sourceId: formattedId,
        relatedIds: limitedIds,
        count: relatedIds.length,
    };
}
/**
 * Get articles that cite the given article
 */
export async function getCitations(pmid, maxResults = 50) {
    const client = getClient();
    const formattedId = formatPmid(pmid);
    const citingIds = await client.getCitingArticles(formattedId);
    // Limit results
    const limitedIds = citingIds.slice(0, maxResults);
    return {
        sourceId: formattedId,
        citingArticles: limitedIds,
        count: citingIds.length,
    };
}
/**
 * Get references (articles cited by the given article)
 */
export async function getReferences(pmid, maxResults = 100) {
    const client = getClient();
    const formattedId = formatPmid(pmid);
    const referenceIds = await client.getReferences(formattedId);
    // Limit results
    const limitedIds = referenceIds.slice(0, maxResults);
    return {
        sourceId: formattedId,
        references: limitedIds,
        count: referenceIds.length,
    };
}
/**
 * Get citation metrics for an article
 */
export async function getCitationMetrics(pmid) {
    const client = getClient();
    const formattedId = formatPmid(pmid);
    // Fetch all link types in parallel
    const [citingIds, referenceIds, relatedIds] = await Promise.all([
        client.getCitingArticles(formattedId),
        client.getReferences(formattedId),
        client.findRelatedArticles(formattedId),
    ]);
    return {
        pmid: formattedId,
        citedByCount: citingIds.length,
        referencesCount: referenceIds.length,
        relatedCount: relatedIds.length,
    };
}
//# sourceMappingURL=link.js.map