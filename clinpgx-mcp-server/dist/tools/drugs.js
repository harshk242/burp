// Drug-related tool implementations for ClinPGx MCP Server
import { getClient } from '../client.js';
/**
 * Search for drugs by name
 */
export async function searchDrugs(query, maxResults = 20) {
    const client = getClient();
    return client.searchDrugs(query, maxResults);
}
/**
 * Get detailed information about a specific drug
 */
export async function getDrugInfo(drugName) {
    const client = getClient();
    return client.getDrugInfo(drugName);
}
/**
 * Get FDA/EMA drug labels for a drug
 */
export async function getDrugLabels(drugName) {
    const client = getClient();
    return client.getDrugLabels(drugName);
}
/**
 * Get drugs with pharmacogenomic guidelines
 */
export async function getDrugsWithGuidelines(maxResults = 50) {
    const client = getClient();
    const result = await client.searchDrugs('', maxResults);
    return result.results.filter(drug => drug.hasGuidelines);
}
/**
 * Get drugs with clinical annotations
 */
export async function getDrugsWithAnnotations(maxResults = 50) {
    const client = getClient();
    const result = await client.searchDrugs('', maxResults);
    return result.results.filter(drug => drug.hasClinicalAnnotations);
}
//# sourceMappingURL=drugs.js.map