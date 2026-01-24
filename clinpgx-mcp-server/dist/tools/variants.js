// Variant-related tool implementations for ClinPGx MCP Server
import { getClient } from '../client.js';
/**
 * Search for pharmacogenomic variants
 */
export async function searchVariants(query, maxResults = 20) {
    const client = getClient();
    return client.searchVariants(query, maxResults);
}
/**
 * Get variant information by ID or rsID
 */
export async function getVariantInfo(variantId) {
    const client = getClient();
    return client.getVariantInfo(variantId);
}
/**
 * Get clinical annotations for a specific variant
 */
export async function getVariantAnnotations(variantId) {
    const client = getClient();
    // First get variant info to get the gene
    const variant = await client.getVariantInfo(variantId);
    if (!variant || !variant.gene) {
        return [];
    }
    // Get annotations for the gene and filter by variant
    const annotations = await client.getClinicalAnnotationsForGene(variant.gene);
    return annotations.filter(annotation => annotation.variant?.toLowerCase().includes(variantId.toLowerCase()) ||
        (variant.rsid && annotation.variant?.includes(variant.rsid)));
}
/**
 * Search variants by gene
 */
export async function searchVariantsByGene(gene, maxResults = 50) {
    const client = getClient();
    const result = await client.searchVariants(gene, maxResults);
    return result.results.filter(variant => variant.gene?.toLowerCase() === gene.toLowerCase());
}
/**
 * Get variants with clinical annotations
 */
export async function getVariantsWithAnnotations(gene) {
    const client = getClient();
    const result = await client.searchVariants(gene, 100);
    return result.results.filter(variant => variant.gene?.toLowerCase() === gene.toLowerCase() &&
        variant.hasClinicalAnnotations);
}
/**
 * Get star alleles for a gene (CYP genes typically)
 */
export async function getStarAlleles(gene) {
    const client = getClient();
    const result = await client.searchVariants(`${gene}*`, 100);
    return result.results.filter(variant => variant.name?.includes('*') &&
        variant.gene?.toLowerCase() === gene.toLowerCase());
}
//# sourceMappingURL=variants.js.map