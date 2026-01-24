// Search tools for PubMed MCP Server
import { getClient } from '../client.js';
import { buildSearchQuery } from '../utils.js';
/**
 * Basic PubMed search
 */
export async function searchPubmed(query, maxResults = 20, start = 0, sort) {
    const client = getClient();
    const result = await client.search(query, {
        maxResults,
        start,
        sort,
    });
    return {
        count: result.count,
        pmids: result.pmids,
        queryTranslation: result.queryTranslation,
        returnedCount: result.pmids.length,
    };
}
/**
 * Advanced search with filters
 */
export async function searchWithFilters(query, filters, maxResults = 20, start = 0) {
    const client = getClient();
    const fullQuery = buildSearchQuery(query, filters);
    const result = await client.search(fullQuery, {
        maxResults,
        start,
    });
    const appliedFilters = [];
    if (filters.dateRange) {
        appliedFilters.push(`Date range: ${filters.dateRange.start} to ${filters.dateRange.end}`);
    }
    if (filters.publicationType && filters.publicationType.length > 0) {
        appliedFilters.push(`Publication types: ${filters.publicationType.join(', ')}`);
    }
    if (filters.language) {
        appliedFilters.push(`Language: ${filters.language}`);
    }
    if (filters.hasAbstract) {
        appliedFilters.push('Has abstract');
    }
    if (filters.freeFullText) {
        appliedFilters.push('Free full text');
    }
    if (filters.humanOnly) {
        appliedFilters.push('Human studies only');
    }
    if (filters.journalList && filters.journalList.length > 0) {
        appliedFilters.push(`Journals: ${filters.journalList.join(', ')}`);
    }
    return {
        count: result.count,
        pmids: result.pmids,
        queryTranslation: result.queryTranslation,
        appliedFilters,
    };
}
/**
 * Search by author name
 */
export async function searchByAuthor(authorName, additionalQuery, maxResults = 20) {
    const client = getClient();
    // Format author search query
    let query = `"${authorName}"[Author]`;
    if (additionalQuery) {
        query = `${query} AND (${additionalQuery})`;
    }
    const result = await client.search(query, {
        maxResults,
        sort: 'date',
    });
    return {
        count: result.count,
        pmids: result.pmids,
        queryTranslation: result.queryTranslation,
    };
}
/**
 * Search by journal name
 */
export async function searchByJournal(journalName, additionalQuery, maxResults = 20, minDate, maxDate) {
    const client = getClient();
    // Format journal search query
    let query = `"${journalName}"[Journal]`;
    if (additionalQuery) {
        query = `${query} AND (${additionalQuery})`;
    }
    const result = await client.search(query, {
        maxResults,
        sort: 'date',
        minDate,
        maxDate,
    });
    return {
        count: result.count,
        pmids: result.pmids,
        queryTranslation: result.queryTranslation,
    };
}
/**
 * Search clinical trials literature
 */
export async function searchClinicalTrialsLiterature(condition, intervention, maxResults = 20) {
    const client = getClient();
    // Build clinical trial search query
    let query = `"${condition}"[MeSH Terms] AND (Clinical Trial[Publication Type] OR Randomized Controlled Trial[Publication Type])`;
    if (intervention) {
        query = `${query} AND "${intervention}"[MeSH Terms]`;
    }
    const result = await client.search(query, {
        maxResults,
        sort: 'date',
    });
    return {
        count: result.count,
        pmids: result.pmids,
        queryTranslation: result.queryTranslation,
    };
}
//# sourceMappingURL=search.js.map