import { parseGuidelineSource, parseEvidenceLevel, normalizePhenotypeCategory } from './utils.js';
import type { GeneInfo, DrugInfo, VariantInfo, ClinicalAnnotation, DosingGuideline, DrugLabel, Pathway } from './types.js';

type AnyObject = Record<string, any>;

export function parseGeneInfo(data: AnyObject): GeneInfo {
  return {
    id: data.id || data.pharmgkbAccessionId,
    symbol: data.symbol,
    name: data.name,
    alternateSymbols: data.alternateSymbols,
    chromosomeLocation: data.chromosomeLocation,
    pharmgkbAccessionId: data.pharmgkbAccessionId,
    hasVariants: data.hasVariantAnnotation,
    hasGuidelines: data.hasGuideline,
    hasClinicalAnnotations: data.hasClinicalAnnotation,
    crossReferences: data.crossReferences?.map((xref: AnyObject) => ({
      database: xref.resource,
      id: xref.resourceId,
      url: xref.url,
    })),
    summary: data.summary,
  };
}

export function parseDrugInfo(data: AnyObject): DrugInfo {
  return {
    id: data.id || data.pharmgkbAccessionId,
    name: data.name,
    genericNames: data.genericNames,
    brandNames: data.brandNames,
    drugClass: data.drugClasses?.[0]?.name,
    atcCodes: data.atcCodes,
    pharmgkbAccessionId: data.pharmgkbAccessionId,
    hasGuidelines: data.hasGuideline,
    hasClinicalAnnotations: data.hasClinicalAnnotation,
    hasLabels: data.hasLabel,
    crossReferences: data.crossReferences?.map((xref: AnyObject) => ({
      database: xref.resource,
      id: xref.resourceId,
      url: xref.url,
    })),
    summary: data.summary,
  };
}

export function parseVariantInfo(data: AnyObject): VariantInfo {
  return {
    id: data.id || data.pharmgkbAccessionId,
    name: data.name,
    rsid: data.rsid,
    gene: data.gene?.symbol,
    variantType: data.variantType,
    location: data.location,
    hasClinicalAnnotations: data.hasClinicalAnnotation,
    hasGuidelines: data.hasGuideline,
    crossReferences: data.crossReferences?.map((xref: AnyObject) => ({
      database: xref.resource,
      id: xref.resourceId,
      url: xref.url,
    })),
  };
}

export function parseClinicalAnnotation(data: AnyObject): ClinicalAnnotation {
  const levelOfEvidence = data.levelOfEvidence;
  const evidenceLevel = typeof levelOfEvidence === 'object' && levelOfEvidence !== null
    ? levelOfEvidence.term
    : levelOfEvidence;

  const genes = data.location?.genes || data.genes || [];
  const geneSymbol = genes[0]?.symbol;

  const chemicals = data.relatedChemicals || data.chemicals || [];
  const drugName = chemicals[0]?.name;

  const types = data.types || [];
  const phenotypeCategory = types[0] || 'Unknown';

  return {
    id: data.id,
    gene: geneSymbol,
    drug: drugName,
    variant: data.variant?.name || data.location?.displayName,
    phenotypeCategory: normalizePhenotypeCategory(phenotypeCategory),
    levelOfEvidence: parseEvidenceLevel(evidenceLevel),
    annotation: data.text || data.allelePhenotypes?.[0]?.phenotype,
    alleles: data.allelePhenotypes?.map((ap: AnyObject) => ap.allele),
    phenotypes: data.phenotypes?.map((p: AnyObject) => typeof p === 'string' ? p : p.name),
    populations: data.populations,
    relatedChemicals: chemicals.map((c: AnyObject) => c.name),
    relatedGenes: genes.map((g: AnyObject) => g.symbol),
    pmids: data.literature?.map((l: AnyObject) => l.pmid),
  };
}

export function parseDosingGuideline(data: AnyObject): DosingGuideline {
  return {
    id: data.id,
    name: data.name,
    source: parseGuidelineSource(data.name || data.source),
    genes: data.genes?.map((g: AnyObject) => g.symbol) || [],
    drugs: data.chemicals?.map((c: AnyObject) => c.name) || [],
    recommendation: data.recommendation,
    implications: data.implications,
    phenotypeCategory: data.phenotypeCategory,
    alternateDrug: data.alternateDrug,
    url: data.url || `https://www.pharmgkb.org/guideline/${data.id}`,
    version: data.version,
    lastModified: data.lastModified,
  };
}

export function parseDrugLabel(data: AnyObject): DrugLabel {
  return {
    id: data.id,
    name: data.name,
    drug: data.chemical?.name,
    source: data.source,
    agency: data.agency,
    approvalDate: data.approvalDate,
    biomarkerCategory: data.biomarkerCategory,
    genes: data.genes?.map((g: AnyObject) => g.symbol),
    variants: data.variants?.map((v: AnyObject) => v.name),
    labelText: data.text,
    url: data.url,
  };
}

export function parsePathway(pathway: AnyObject): Pathway {
  return {
    id: pathway.id,
    name: pathway.name,
    type: pathway.type,
    description: pathway.description,
    genes: pathway.genes?.map((g: AnyObject) => g.symbol),
    drugs: pathway.chemicals?.map((c: AnyObject) => c.name),
    url: pathway.url || `https://www.pharmgkb.org/pathway/${pathway.id}`,
  };
}
