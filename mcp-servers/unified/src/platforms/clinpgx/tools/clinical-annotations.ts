// Clinical annotation tool implementations for ClinPGx platform module

import { getClient } from '../client.js';
import type { ClinicalAnnotation, DrugGeneInteraction } from '../types.js';

/**
 * Get clinical annotations for a gene
 */
export async function getClinicalAnnotationsForGene(
  gene: string
): Promise<ClinicalAnnotation[]> {
  const client = getClient();
  return client.getClinicalAnnotationsForGene(gene);
}

/**
 * Get clinical annotations for a drug
 */
export async function getClinicalAnnotationsForDrug(
  drug: string
): Promise<ClinicalAnnotation[]> {
  const client = getClient();
  return client.getClinicalAnnotationsForDrug(drug);
}

/**
 * Get clinical annotations for a specific drug-gene pair
 */
export async function getDrugGeneAnnotations(
  drug: string,
  gene: string
): Promise<ClinicalAnnotation[]> {
  const client = getClient();
  return client.getDrugGeneAnnotations(drug, gene);
}

/**
 * Get all drug-gene interactions for a gene
 */
export async function getDrugGeneInteractions(
  gene: string
): Promise<DrugGeneInteraction[]> {
  const client = getClient();
  return client.getDrugGeneInteractions(gene);
}

/**
 * Get clinical annotations by evidence level
 */
export async function getAnnotationsByEvidenceLevel(
  gene: string,
  minLevel: string = '1A'
): Promise<ClinicalAnnotation[]> {
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
export async function getAnnotationsByPhenotype(
  gene: string,
  phenotypeCategory: string
): Promise<ClinicalAnnotation[]> {
  const client = getClient();
  const annotations = await client.getClinicalAnnotationsForGene(gene);

  return annotations.filter(annotation =>
    annotation.phenotypeCategory?.toLowerCase().includes(phenotypeCategory.toLowerCase())
  );
}
