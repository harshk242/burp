import type { MeshTerm } from '../types.js';
/**
 * Get MeSH terms for an article
 */
export declare function getMeshTerms(pmid: string): Promise<{
    pmid: string;
    meshTerms: MeshTerm[];
    majorTopics: string[];
}>;
/**
 * Get publication trends for a query over years
 */
export declare function getPublicationTrends(query: string, startYear: number, endYear?: number): Promise<{
    query: string;
    years: Array<{
        year: number;
        count: number;
    }>;
    totalCount: number;
    averagePerYear: number;
}>;
/**
 * Format a citation for an article
 */
export declare function formatCitation(pmid: string, style?: 'apa' | 'mla' | 'vancouver' | 'bibtex'): Promise<{
    pmid: string;
    citation: string;
    style: string;
}>;
/**
 * Compare multiple articles' basic metadata
 */
export declare function compareArticles(pmids: string[]): Promise<{
    articles: Array<{
        pmid: string;
        title: string;
        year: string;
        journal: string;
        authors: number;
        hasMesh: boolean;
        hasAbstract: boolean;
    }>;
}>;
/**
 * Extract keywords and key terms from multiple articles
 */
export declare function extractKeyTerms(pmids: string[]): Promise<{
    meshTermFrequency: Array<{
        term: string;
        count: number;
    }>;
    keywordFrequency: Array<{
        keyword: string;
        count: number;
    }>;
    publicationTypes: Array<{
        type: string;
        count: number;
    }>;
}>;
//# sourceMappingURL=analysis.d.ts.map