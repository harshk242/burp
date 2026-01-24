import type { ClinicalAnnotation, DrugGeneInteraction } from '../types.js';
/**
 * Get clinical annotations for a gene
 */
export declare function getClinicalAnnotationsForGene(gene: string): Promise<ClinicalAnnotation[]>;
/**
 * Get clinical annotations for a drug
 */
export declare function getClinicalAnnotationsForDrug(drug: string): Promise<ClinicalAnnotation[]>;
/**
 * Get clinical annotations for a specific drug-gene pair
 */
export declare function getDrugGeneAnnotations(drug: string, gene: string): Promise<ClinicalAnnotation[]>;
/**
 * Get all drug-gene interactions for a gene
 */
export declare function getDrugGeneInteractions(gene: string): Promise<DrugGeneInteraction[]>;
/**
 * Get clinical annotations by evidence level
 */
export declare function getAnnotationsByEvidenceLevel(gene: string, minLevel?: string): Promise<ClinicalAnnotation[]>;
/**
 * Get clinical annotations by phenotype category
 */
export declare function getAnnotationsByPhenotype(gene: string, phenotypeCategory: string): Promise<ClinicalAnnotation[]>;
//# sourceMappingURL=clinical-annotations.d.ts.map