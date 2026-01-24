import type { SearchFilters } from '../types.js';
/**
 * Basic PubMed search
 */
export declare function searchPubmed(query: string, maxResults?: number, start?: number, sort?: string): Promise<{
    count: number;
    pmids: string[];
    queryTranslation: string;
    returnedCount: number;
}>;
/**
 * Advanced search with filters
 */
export declare function searchWithFilters(query: string, filters: SearchFilters, maxResults?: number, start?: number): Promise<{
    count: number;
    pmids: string[];
    queryTranslation: string;
    appliedFilters: string[];
}>;
/**
 * Search by author name
 */
export declare function searchByAuthor(authorName: string, additionalQuery?: string, maxResults?: number): Promise<{
    count: number;
    pmids: string[];
    queryTranslation: string;
}>;
/**
 * Search by journal name
 */
export declare function searchByJournal(journalName: string, additionalQuery?: string, maxResults?: number, minDate?: string, maxDate?: string): Promise<{
    count: number;
    pmids: string[];
    queryTranslation: string;
}>;
/**
 * Search clinical trials literature
 */
export declare function searchClinicalTrialsLiterature(condition: string, intervention?: string, maxResults?: number): Promise<{
    count: number;
    pmids: string[];
    queryTranslation: string;
}>;
//# sourceMappingURL=search.d.ts.map