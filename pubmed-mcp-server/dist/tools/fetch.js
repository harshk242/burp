// Article fetch tools for PubMed MCP Server
import { getClient } from '../client.js';
import { formatPmid, formatPmids } from '../utils.js';
/**
 * Fetch full article details by PMID
 */
export async function fetchArticleDetails(pmid) {
    const client = getClient();
    const formattedId = formatPmid(pmid);
    const articles = await client.fetchArticles(formattedId);
    return articles.length > 0 ? articles[0] : null;
}
/**
 * Get article abstract only
 */
export async function getArticleAbstract(pmid) {
    const client = getClient();
    const formattedId = formatPmid(pmid);
    const articles = await client.fetchArticles(formattedId);
    if (articles.length === 0) {
        return {
            pmid: formattedId,
            title: 'Not found',
            abstract: null,
            authors: [],
        };
    }
    const article = articles[0];
    return {
        pmid: article.pmid,
        title: article.title,
        abstract: article.abstract || null,
        authors: article.authors.map((a) => a.collectiveName || `${a.lastName || ''} ${a.foreName || a.initials || ''}`.trim()),
    };
}
/**
 * Get article summary (lightweight metadata)
 */
export async function getArticleSummary(pmid) {
    const client = getClient();
    const formattedId = formatPmid(pmid);
    const summaries = await client.getArticleSummaries(formattedId);
    return summaries.length > 0 ? summaries[0] : null;
}
/**
 * Batch fetch multiple articles
 */
export async function batchFetchArticles(pmids, includeAbstracts = true) {
    if (pmids.length === 0) {
        return { articles: [], found: 0, notFound: [] };
    }
    // Limit batch size to 200 (NCBI recommended max)
    const batchSize = 200;
    const batches = [];
    for (let i = 0; i < pmids.length; i += batchSize) {
        batches.push(pmids.slice(i, i + batchSize));
    }
    const client = getClient();
    const allArticles = [];
    for (const batch of batches) {
        const formattedIds = formatPmids(batch);
        const articles = await client.fetchArticles(formattedIds);
        allArticles.push(...articles);
    }
    // Find PMIDs that weren't found
    const foundPmids = new Set(allArticles.map((a) => a.pmid));
    const notFound = pmids.filter((p) => !foundPmids.has(formatPmid(p)));
    // Optionally strip abstracts for smaller response
    const responseArticles = includeAbstracts
        ? allArticles
        : allArticles.map((a) => ({ ...a, abstract: undefined }));
    return {
        articles: responseArticles,
        found: allArticles.length,
        notFound,
    };
}
/**
 * Get article summaries for multiple PMIDs
 */
export async function batchGetSummaries(pmids) {
    if (pmids.length === 0) {
        return { summaries: [], found: 0 };
    }
    const client = getClient();
    const formattedIds = formatPmids(pmids);
    const summaries = await client.getArticleSummaries(formattedIds);
    return {
        summaries,
        found: summaries.length,
    };
}
//# sourceMappingURL=fetch.js.map