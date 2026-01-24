export interface CacheEntry {
    data: unknown;
    timestamp: number;
}
export interface GeneInfo {
    id: string;
    symbol: string;
    name?: string;
    alternateSymbols?: string[];
    chromosomeLocation?: string;
    pharmgkbAccessionId?: string;
    hasVariants?: boolean;
    hasGuidelines?: boolean;
    hasClinicalAnnotations?: boolean;
    crossReferences?: CrossReference[];
    summary?: string;
}
export interface DrugInfo {
    id: string;
    name: string;
    genericNames?: string[];
    brandNames?: string[];
    drugClass?: string;
    atcCodes?: string[];
    pharmgkbAccessionId?: string;
    hasGuidelines?: boolean;
    hasClinicalAnnotations?: boolean;
    hasLabels?: boolean;
    crossReferences?: CrossReference[];
    summary?: string;
}
export interface VariantInfo {
    id: string;
    name?: string;
    rsid?: string;
    gene?: string;
    variantType?: string;
    location?: string;
    hasClinicalAnnotations?: boolean;
    hasGuidelines?: boolean;
    crossReferences?: CrossReference[];
}
export interface ClinicalAnnotation {
    id: string;
    gene: string;
    drug: string;
    variant?: string;
    phenotypeCategory?: string;
    levelOfEvidence?: string;
    annotation?: string;
    alleles?: string[];
    phenotypes?: string[];
    populations?: string[];
    relatedChemicals?: string[];
    relatedGenes?: string[];
    pmids?: string[];
}
export interface DosingGuideline {
    id: string;
    name: string;
    source: 'CPIC' | 'DPWG' | 'Other';
    genes: string[];
    drugs: string[];
    recommendation?: string;
    implications?: string;
    phenotypeCategory?: string;
    alternateDrug?: string;
    url?: string;
    version?: string;
    lastModified?: string;
}
export interface DrugLabel {
    id: string;
    name: string;
    drug: string;
    source: string;
    agency?: string;
    approvalDate?: string;
    biomarkerCategory?: string;
    genes?: string[];
    variants?: string[];
    labelText?: string;
    url?: string;
}
export interface Pathway {
    id: string;
    name: string;
    type?: string;
    description?: string;
    genes?: string[];
    drugs?: string[];
    url?: string;
}
export interface LiteratureReference {
    pmid: string;
    title?: string;
    authors?: string[];
    journal?: string;
    year?: number;
    doi?: string;
}
export interface CrossReference {
    database: string;
    id: string;
    url?: string;
}
export interface DrugGeneInteraction {
    drug: string;
    gene: string;
    interactionType?: string;
    phenotypeCategory?: string;
    hasGuideline?: boolean;
    hasClinicalAnnotation?: boolean;
    evidenceLevel?: string;
}
export interface VIPAnnotation {
    gene: string;
    summary: string;
    keyVariants?: string[];
    keyDrugs?: string[];
    clinicalRelevance?: string;
}
export interface AlleleFunctionality {
    allele: string;
    gene: string;
    functionality?: string;
    activityScore?: number;
    clinicalFunction?: string;
    haplotype?: string;
}
export interface DiplotypePhenotype {
    gene: string;
    diplotype: string;
    phenotype: string;
    activityScore?: number;
    ehRRecommendation?: string;
}
export interface SearchResult<T> {
    totalCount: number;
    results: T[];
    query: string;
}
export interface PharmGKBClientOptions {
    cacheTtl?: number;
    maxRetries?: number;
    retryDelay?: number;
}
//# sourceMappingURL=types.d.ts.map