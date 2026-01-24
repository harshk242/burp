// Dosing guideline tool implementations for ClinPGx MCP Server
import { getClient } from '../client.js';
/**
 * Get CPIC/DPWG dosing guidelines for a gene
 */
export async function getDosingGuidelinesForGene(gene) {
    const client = getClient();
    return client.getDosingGuidelinesForGene(gene);
}
/**
 * Get CPIC/DPWG dosing guidelines for a drug
 */
export async function getDosingGuidelinesForDrug(drug) {
    const client = getClient();
    return client.getDosingGuidelinesForDrug(drug);
}
/**
 * Get dosing guidelines by source (CPIC or DPWG)
 */
export async function getGuidelinesBySource(gene, source) {
    const client = getClient();
    const guidelines = await client.getDosingGuidelinesForGene(gene);
    return guidelines.filter(guideline => guideline.source === source);
}
/**
 * Get FDA/EMA drug labels
 */
export async function getDrugLabels(drug) {
    const client = getClient();
    return client.getDrugLabels(drug);
}
/**
 * Get all guidelines for a drug-gene pair
 */
export async function getGuidelinesForDrugGenePair(drug, gene) {
    const client = getClient();
    const [allGuidelines, labels] = await Promise.all([
        client.getDosingGuidelinesForDrug(drug),
        client.getDrugLabels(drug),
    ]);
    // Filter guidelines to those involving the specific gene
    const guidelines = allGuidelines.filter(g => g.genes.some(geneSymbol => geneSymbol.toLowerCase() === gene.toLowerCase()));
    // Filter labels to those involving the specific gene
    const relevantLabels = labels.filter(label => label.genes?.some(geneSymbol => geneSymbol.toLowerCase() === gene.toLowerCase()));
    return { guidelines, labels: relevantLabels };
}
/**
 * Get actionable drug-gene pairs (those with guidelines)
 */
export async function getActionablePairs(gene) {
    const client = getClient();
    const guidelines = await client.getDosingGuidelinesForGene(gene);
    // Group by drug
    const drugMap = new Map();
    for (const guideline of guidelines) {
        for (const drug of guideline.drugs) {
            drugMap.set(drug, (drugMap.get(drug) || 0) + 1);
        }
    }
    return Array.from(drugMap.entries()).map(([drug, count]) => ({
        drug,
        gene,
        guidelineCount: count,
    }));
}
//# sourceMappingURL=guidelines.js.map