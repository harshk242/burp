import { parseGuidelineSource, parseEvidenceLevel, normalizePhenotypeCategory } from './utils.js';
import { record, child, list, text, required, flag, texts, names } from './response-decoding.js';
import type { GeneInfo, DrugInfo, VariantInfo, ClinicalAnnotation, DosingGuideline, DrugLabel, Pathway, CrossReference } from './types.js';

function narrative(value: unknown): string | undefined {
  return value !== null && typeof value === 'object' ? text(record(value).html) : text(value);
}

function crossReferences(value: unknown): CrossReference[] {
  return list(value).map(value => {
    const xref = record(value);
    return { database: required(xref.resource, 'resource'), id: required(xref.resourceId, 'resourceId'), url: text(xref.url) };
  });
}

export function parseGeneInfo(value: unknown): GeneInfo {
  const data = record(value);
  return {
    id: required(data.id ?? data.pharmgkbAccessionId, 'gene id'), symbol: required(data.symbol, 'gene symbol'),
    name: text(data.name), alternateSymbols: texts(data.alternateSymbols), chromosomeLocation: text(data.chromosomeLocation),
    pharmgkbAccessionId: text(data.pharmgkbAccessionId), hasVariants: flag(data.hasVariantAnnotation),
    hasGuidelines: flag(data.hasGuideline), hasClinicalAnnotations: flag(data.hasClinicalAnnotation),
    crossReferences: crossReferences(data.crossReferences), summary: narrative(data.summary),
  };
}

export function parseDrugInfo(value: unknown): DrugInfo {
  const data = record(value);
  return {
    id: required(data.id ?? data.pharmgkbAccessionId, 'drug id'), name: required(data.name, 'drug name'),
    genericNames: texts(data.genericNames), brandNames: texts(data.brandNames), drugClass: text(child(list(data.drugClasses)[0]).name),
    atcCodes: texts(data.atcCodes), pharmgkbAccessionId: text(data.pharmgkbAccessionId), hasGuidelines: flag(data.hasGuideline),
    hasClinicalAnnotations: flag(data.hasClinicalAnnotation), hasLabels: flag(data.hasLabel),
    crossReferences: crossReferences(data.crossReferences), summary: narrative(data.summary),
  };
}

export function parseVariantInfo(value: unknown): VariantInfo {
  const data = record(value);
  return {
    id: required(data.id ?? data.pharmgkbAccessionId, 'variant id'), name: text(data.name), rsid: text(data.rsid),
    gene: text(child(data.gene).symbol), variantType: text(data.variantType), location: text(data.location),
    hasClinicalAnnotations: flag(data.hasClinicalAnnotation), hasGuidelines: flag(data.hasGuideline), crossReferences: crossReferences(data.crossReferences),
  };
}

export function parseClinicalAnnotation(value: unknown): ClinicalAnnotation {
  const data = record(value);
  const location = child(data.location);
  const genes = names(location.genes ?? data.genes, 'symbol');
  const chemicals = names(data.relatedChemicals ?? data.chemicals, 'name');
  const allelePhenotypes = list(data.allelePhenotypes).map(record);
  const evidence = typeof data.levelOfEvidence === 'object' && data.levelOfEvidence !== null ? child(data.levelOfEvidence).term : data.levelOfEvidence;
  return {
    id: required(data.id, 'annotation id'), gene: required(genes[0], 'annotation gene'), drug: required(chemicals[0], 'annotation drug'),
    variant: text(child(data.variant).name ?? location.displayName),
    phenotypeCategory: normalizePhenotypeCategory(texts(data.types)[0] ?? 'Unknown'), levelOfEvidence: parseEvidenceLevel(text(evidence)),
    annotation: text(data.text ?? allelePhenotypes[0]?.phenotype), alleles: allelePhenotypes.map(item => required(item.allele, 'allele')),
    phenotypes: list(data.phenotypes).map(item => required(typeof item === 'string' ? item : record(item).name, 'phenotype')),
    populations: texts(data.populations), relatedChemicals: chemicals, relatedGenes: genes, pmids: names(data.literature, 'pmid'),
  };
}

export function parseDosingGuideline(value: unknown): DosingGuideline {
  const data = record(value);
  const id = required(data.id, 'guideline id');
  const name = required(data.name, 'guideline name');
  return {
    id, name, source: parseGuidelineSource(name), genes: names(data.genes ?? data.relatedGenes, 'symbol'),
    drugs: names(data.chemicals ?? data.relatedChemicals, 'name'), recommendation: typeof data.recommendation === 'boolean' ? undefined : narrative(data.recommendation), hasRecommendation: typeof data.recommendation === 'boolean' ? flag(data.recommendation) : undefined, implications: text(data.implications),
    phenotypeCategory: text(data.phenotypeCategory), alternateDrug: text(data.alternateDrug), url: text(data.url) ?? `https://www.pharmgkb.org/guideline/${id}`,
    version: text(data.version), lastModified: text(data.lastModified),
  };
}

export function parseDrugLabel(value: unknown): DrugLabel {
  const data = record(value);
  return {
    id: required(data.id, 'label id'), name: required(data.name, 'label name'), drug: required(child(data.chemical).name ?? names(data.relatedChemicals, 'name')[0], 'label drug'),
    source: required(data.source, 'label source'), agency: text(data.agency), approvalDate: text(data.approvalDate),
    biomarkerCategory: text(data.biomarkerCategory), genes: names(data.genes ?? data.relatedGenes, 'symbol'), variants: names(data.variants, 'name'), labelText: text(data.text), url: text(data.url),
  };
}

export function parsePathway(value: unknown): Pathway {
  const data = record(value);
  const id = required(data.id, 'pathway id');
  return {
    id, name: required(data.name, 'pathway name'), type: text(data.type), description: narrative(data.description),
    genes: names(data.genes, 'symbol'), drugs: names(data.chemicals, 'name'), url: text(data.url) ?? `https://www.pharmgkb.org/pathway/${id}`,
  };
}
