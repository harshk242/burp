// Fields of UniProtKB REST JSON entries that the tools read. Entries carry many more
// fields, and handlers return them as-is, so every record type stays open.

export interface UniProtValue {
  value?: string | undefined;
}

export interface UniProtEvidence {
  evidenceCode?: string | undefined;
  [key: string]: unknown;
}

export interface UniProtFeature {
  type: string;
  description?: string | undefined;
  evidences?: UniProtEvidence[] | undefined;
  [key: string]: unknown;
}

export interface UniProtComment {
  commentType: string;
  disease?: { acronym?: string | undefined; [key: string]: unknown } | undefined;
  texts?: UniProtValue[] | undefined;
  [key: string]: unknown;
}

export interface UniProtCrossReference {
  database: string;
  id: string;
  [key: string]: unknown;
}

export interface UniProtReference {
  citation?: { citationCrossReferences?: UniProtCrossReference[] | undefined; [key: string]: unknown } | undefined;
  [key: string]: unknown;
}

export interface UniProtGene {
  geneName?: UniProtValue | undefined;
  synonyms?: UniProtValue[] | undefined;
  orderedLocusNames?: UniProtValue[] | undefined;
  orfNames?: UniProtValue[] | undefined;
}

export interface UniProtProteinName {
  fullName?: UniProtValue | undefined;
}

export interface UniProtEntry {
  primaryAccession?: string | undefined;
  uniProtkbId?: string | undefined;
  entryType?: string | undefined;
  proteinExistence?: string | undefined;
  annotationScore?: number | undefined;
  proteinDescription?: {
    recommendedName?: UniProtProteinName | undefined;
    submissionNames?: UniProtProteinName[] | undefined;
    alternativeNames?: UniProtProteinName[] | undefined;
  } | undefined;
  genes?: UniProtGene[] | undefined;
  organism?: { scientificName?: string | undefined; commonName?: string | undefined; taxonId?: number | undefined; lineage?: string[] | undefined; [key: string]: unknown } | undefined;
  sequence?: { value?: string | undefined; length?: number | undefined; molWeight?: number | undefined; [key: string]: unknown } | undefined;
  features?: UniProtFeature[] | undefined;
  comments?: UniProtComment[] | undefined;
  keywords?: unknown[] | undefined;
  references?: UniProtReference[] | undefined;
  uniProtKBCrossReferences?: UniProtCrossReference[] | undefined;
  extraAttributes?: { countByFeatureType?: Record<string, number> | undefined; [key: string]: unknown } | undefined;
  [key: string]: unknown;
}

export interface UniProtSearchResponse {
  results?: UniProtEntry[] | undefined;
}
