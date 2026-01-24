// Clinical annotation tool implementations for ClinPGx MCP Server
import { getClient } from '../client.js';
/**
 * Get clinical annotations for a gene
 */
export async function getClinicalAnnotationsForGene(gene) {
    const client = getClient();
    return client.getClinicalAnnotationsForGene(gene);
}
/**
 * Get clinical annotations for a drug
 */
export async function getClinicalAnnotationsForDrug(drug) {
    const client = getClient();
    return client.getClinicalAnnotationsForDrug(drug);
}
/**
 * Get clinical annotations for a specific drug-gene pair
 */
export async function getDrugGeneAnnotations(drug, gene) {
    const client = getClient();
    return client.getDrugGeneAnnotations(drug, gene);
}
/**
 * Get all drug-gene interactions for a gene
 */
export async function getDrugGeneInteractions(gene) {
    const client = getClient();
    return client.getDrugGeneInteractions(gene);
}
/**
 * Get clinical annotations by evidence level
 */
export async function getAnnotationsByEvidenceLevel(gene, minLevel = '1A') {
    const client = getClient();
    const annotations = await client.getClinicalAnnotationsForGene(gene);
    const levelOrder = ['1A', '1B', '2A', '2B', '3', '4'];
    const minLevelIndex = levelOrder.indexOf(minLevel);
    if (minLevelIndex === -1) {
        return annotations;
    }
    return annotations.filter(annotation => {
        const level = annotation.levelOfEvidence || '4';
        const levelIndex = levelOrder.indexOf(level);
        return levelIndex !== -1 && levelIndex <= minLevelIndex;
    });
}
/**
 * Get clinical annotations by phenotype category
 */
export async function getAnnotationsByPhenotype(gene, phenotypeCategory) {
    const client = getClient();
    const annotations = await client.getClinicalAnnotationsForGene(gene);
    return annotations.filter(annotation => annotation.phenotypeCategory?.toLowerCase().includes(phenotypeCategory.toLowerCase()));
}
//# sourceMappingURL=clinical-annotations.js.map