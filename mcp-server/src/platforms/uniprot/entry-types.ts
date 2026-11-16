// Fields of UniProtKB REST JSON entries that the tools read. Entries carry many more
// fields, and handlers return them as-is, so every record type stays open.

export interface UniProtValue {
  value?: string;
}

export interface UniProtEvidence {
  evidenceCode?: string;
  [key: string]: unknown;
}

export interface UniProtFeature {
  type: string;
  description?: string;
  evidences?: UniProtEvidence[];
  [key: string]: unknown;
}

export interface UniProtComment {
  commentType: string;
  disease?: { acronym?: string; [key: string]: unknown };
  texts?: UniProtValue[];
  [key: string]: unknown;
}

export interface UniProtCrossReference {
  database: string;
  id: string;
  [key: string]: unknown;
}

export interface UniProtReference {
  citation?: { citationCrossReferences?: UniProtCrossReference[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface UniProtGene {
  geneName?: UniProtValue;
  synonyms?: UniProtValue[];
  orderedLocusNames?: UniProtValue[];
  orfNames?: UniProtValue[];
}

export interface UniProtProteinName {
  fullName?: UniProtValue;
}

export interface UniProtEntry {
  primaryAccession: string;
  uniProtkbId?: string;
  entryType?: string;
  proteinExistence?: string;
  annotationScore?: number;
  proteinDescription?: {
    recommendedName?: UniProtProteinName;
    submissionNames?: UniProtProteinName[];
    alternativeNames?: UniProtProteinName[];
  };
  genes?: UniProtGene[];
  organism?: { scientificName?: string; commonName?: string; taxonId?: number; lineage?: string[]; [key: string]: unknown };
  sequence?: { value?: string; length?: number; molWeight?: number; [key: string]: unknown };
  features?: UniProtFeature[];
  comments?: UniProtComment[];
  keywords?: unknown[];
  references?: UniProtReference[];
  uniProtKBCrossReferences?: UniProtCrossReference[];
  extraAttributes?: { countByFeatureType?: Record<string, number>; [key: string]: unknown };
  [key: string]: unknown;
}

export interface UniProtSearchResponse {
  results?: UniProtEntry[];
}
