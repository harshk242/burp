import { getClient } from '../client.js';
import type { ClinicalAnnotation, DrugGeneInteraction } from '../types.js';

export async function getClinicalAnnotationsForGene(
  gene: string
): Promise<ClinicalAnnotation[]> {
  const client = getClient();
  return client.getClinicalAnnotationsForGene(gene);
}

export async function getClinicalAnnotationsForDrug(
  drug: string
): Promise<ClinicalAnnotation[]> {
  const client = getClient();
  return client.getClinicalAnnotationsForDrug(drug);
}

export async function getDrugGeneAnnotations(
  drug: string,
  gene: string
): Promise<ClinicalAnnotation[]> {
  const client = getClient();
  return client.getDrugGeneAnnotations(drug, gene);
}

export async function getDrugGeneInteractions(
  gene: string
): Promise<DrugGeneInteraction[]> {
  const client = getClient();
  return client.getDrugGeneInteractions(gene);
}

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
