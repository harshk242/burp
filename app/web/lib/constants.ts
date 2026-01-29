export const DATABASE_LABELS: Record<string, string> = {
  uniprot: "UniProt",
  chembl: "ChEMBL",
  pubchem: "PubChem",
  ensembl: "Ensembl",
  clinvar: "ClinVar",
  "open-targets": "Open Targets",
  reactome: "Reactome",
  clinicaltrials: "Clinical Trials",
  pubmed: "PubMed",
  clinpgx: "ClinPGx",
};

export const DATABASE_DESCRIPTIONS: Record<string, string> = {
  uniprot: "Protein sequences, structures, and annotations",
  chembl: "Drug compounds, bioactivity, and pharmacology data",
  pubchem: "Chemical structures, properties, and bioassays",
  ensembl: "Genomic sequences, gene annotations, and variants",
  clinvar: "Clinical significance of genetic variants",
  "open-targets": "Drug-target associations and disease evidence",
  reactome: "Biological pathways and reactions",
  clinicaltrials: "Clinical trial registrations and results",
  pubmed: "Biomedical literature and abstracts",
  clinpgx: "Pharmacogenomics data",
};

export const DATABASE_ORDER = [
  "ensembl",
  "uniprot",
  "chembl",
  "pubchem",
  "clinvar",
  "open-targets",
  "reactome",
  "clinicaltrials",
  "pubmed",
  "clinpgx",
];
