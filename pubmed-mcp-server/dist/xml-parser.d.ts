import type { ESearchResult, ArticleSummary, PubMedArticle, LinkResult } from './types.js';
/**
 * Parse ESearch response
 */
export declare function parseESearchResult(xml: string): ESearchResult;
/**
 * Parse ESummary response
 */
export declare function parseESummaryResult(xml: string): ArticleSummary[];
/**
 * Parse EFetch (full article) response
 */
export declare function parseEFetchResult(xml: string): PubMedArticle[];
/**
 * Parse ELink response
 */
export declare function parseELinkResult(xml: string): LinkResult;
//# sourceMappingURL=xml-parser.d.ts.map