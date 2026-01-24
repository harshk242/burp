// Gene-related tool implementations for ClinPGx MCP Server
import { getClient } from '../client.js';
/**
 * Search for pharmacogenes by name or symbol
 */
export async function searchGenes(query, maxResults = 20) {
    const client = getClient();
    return client.searchGenes(query, maxResults);
}
/**
 * Get detailed information about a specific gene
 */
export async function getGeneInfo(geneSymbol) {
    const client = getClient();
    return client.getGeneInfo(geneSymbol);
}
/**
 * Get pathways associated with a gene
 */
export async function getGenePathways(geneSymbol) {
    const client = getClient();
    return client.getGenePathways(geneSymbol);
}
/**
 * Get VIP (Very Important Pharmacogene) genes
 */
export async function getVIPGenes() {
    const client = getClient();
    // Search for genes with guidelines (VIP genes typically have guidelines)
    const result = await client.searchGenes('', 100);
    return result.results.filter(gene => gene.hasGuidelines);
}
/**
 * Get genes with clinical annotations
 */
export async function getGenesWithAnnotations(maxResults = 50) {
    const client = getClient();
    const result = await client.searchGenes('', maxResults);
    return result.results.filter(gene => gene.hasClinicalAnnotations);
}
//# sourceMappingURL=genes.js.map