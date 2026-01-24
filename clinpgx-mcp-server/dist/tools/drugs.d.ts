import type { DrugInfo, SearchResult, DrugLabel } from '../types.js';
/**
 * Search for drugs by name
 */
export declare function searchDrugs(query: string, maxResults?: number): Promise<SearchResult<DrugInfo>>;
/**
 * Get detailed information about a specific drug
 */
export declare function getDrugInfo(drugName: string): Promise<DrugInfo | null>;
/**
 * Get FDA/EMA drug labels for a drug
 */
export declare function getDrugLabels(drugName: string): Promise<DrugLabel[]>;
/**
 * Get drugs with pharmacogenomic guidelines
 */
export declare function getDrugsWithGuidelines(maxResults?: number): Promise<DrugInfo[]>;
/**
 * Get drugs with clinical annotations
 */
export declare function getDrugsWithAnnotations(maxResults?: number): Promise<DrugInfo[]>;
//# sourceMappingURL=drugs.d.ts.map