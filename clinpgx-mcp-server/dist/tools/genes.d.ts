import type { GeneInfo, SearchResult, Pathway } from '../types.js';
/**
 * Search for pharmacogenes by name or symbol
 */
export declare function searchGenes(query: string, maxResults?: number): Promise<SearchResult<GeneInfo>>;
/**
 * Get detailed information about a specific gene
 */
export declare function getGeneInfo(geneSymbol: string): Promise<GeneInfo | null>;
/**
 * Get pathways associated with a gene
 */
export declare function getGenePathways(geneSymbol: string): Promise<Pathway[]>;
/**
 * Get VIP (Very Important Pharmacogene) genes
 */
export declare function getVIPGenes(): Promise<GeneInfo[]>;
/**
 * Get genes with clinical annotations
 */
export declare function getGenesWithAnnotations(maxResults?: number): Promise<GeneInfo[]>;
//# sourceMappingURL=genes.d.ts.map