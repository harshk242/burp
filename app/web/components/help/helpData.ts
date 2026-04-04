// ─── Database metadata ────────────────────────────────────────────────────────

export interface DatabaseInfo {
  key: string;
  name: string;
  focus: string;
  records: string;
  toolCount: number;
  keyIdentifier: string;
  identifierExample: string;
  exampleQuery: string;
  color: string; // Tailwind bg color class for the left border
}

export const DATABASES: DatabaseInfo[] = [
  {
    key: "ensembl",
    name: "Ensembl",
    focus: "Genomic sequences & gene annotations",
    records: "200+ species",
    toolCount: 25,
    keyIdentifier: "ENSG ID",
    identifierExample: "ENSG00000141510",
    exampleQuery: "What are the transcripts for TP53?",
    color: "bg-violet-500",
  },
  {
    key: "uniprot",
    name: "UniProt",
    focus: "Protein sequences & annotations",
    records: "27M+ proteins",
    toolCount: 26,
    keyIdentifier: "Accession",
    identifierExample: "P04637",
    exampleQuery: "What domains does TP53 protein have?",
    color: "bg-blue-500",
  },
  {
    key: "chembl",
    name: "ChEMBL",
    focus: "Drug compounds & bioactivity",
    records: "2M+ compounds",
    toolCount: 27,
    keyIdentifier: "ChEMBL ID",
    identifierExample: "CHEMBL25",
    exampleQuery: "Find kinase inhibitors for EGFR",
    color: "bg-emerald-500",
  },
  {
    key: "pubchem",
    name: "PubChem",
    focus: "Chemical structures & properties",
    records: "110M+ compounds",
    toolCount: 24,
    keyIdentifier: "CID",
    identifierExample: "2244",
    exampleQuery: "What is the toxicity of aspirin?",
    color: "bg-cyan-500",
  },
  {
    key: "clinvar",
    name: "ClinVar",
    focus: "Clinical variant interpretation",
    records: "1.2M+ variants",
    toolCount: 12,
    keyIdentifier: "rsID",
    identifierExample: "rs1042522",
    exampleQuery: "Is rs1042522 pathogenic?",
    color: "bg-red-500",
  },
  {
    key: "open-targets",
    name: "Open Targets",
    focus: "Target-disease-drug associations",
    records: "45+ sources",
    toolCount: 45,
    keyIdentifier: "EFO ID + ENSG ID",
    identifierExample: "EFO_0000249",
    exampleQuery: "What diseases are linked to BRCA1?",
    color: "bg-orange-500",
  },
  {
    key: "reactome",
    name: "Reactome",
    focus: "Biological pathways",
    records: "2,500+ pathways",
    toolCount: 8,
    keyIdentifier: "Pathway ID",
    identifierExample: "R-HSA-5633007",
    exampleQuery: "What pathways involve TP53?",
    color: "bg-pink-500",
  },
  {
    key: "clinicaltrials",
    name: "ClinicalTrials",
    focus: "Clinical trial registrations",
    records: "400K+ trials",
    toolCount: 18,
    keyIdentifier: "NCT ID",
    identifierExample: "NCT01234567",
    exampleQuery: "Find recruiting trials for breast cancer",
    color: "bg-teal-500",
  },
  {
    key: "pubmed",
    name: "PubMed",
    focus: "Biomedical literature",
    records: "35M+ citations",
    toolCount: 13,
    keyIdentifier: "PMID",
    identifierExample: "33073741",
    exampleQuery: "Find recent CRISPR papers for DMD",
    color: "bg-indigo-500",
  },
  {
    key: "clinpgx",
    name: "ClinPGx",
    focus: "Pharmacogenomics",
    records: "Gene-drug pairs",
    toolCount: 16,
    keyIdentifier: "Star allele",
    identifierExample: "CYP2D6*1",
    exampleQuery: "CYP2D6 poor metabolizer dosing for codeine?",
    color: "bg-amber-500",
  },
];

// ─── Prompt comparison pairs ──────────────────────────────────────────────────

export interface PromptPair {
  vague: string;
  specific: string;
}

export const PROMPT_PAIRS: PromptPair[] = [
  {
    vague: "Tell me about BRCA1",
    specific:
      "What pathogenic ClinVar variants exist in BRCA1, and which Reactome pathways does the BRCA1 protein participate in?",
  },
  {
    vague: "Find drugs for cancer",
    specific:
      "What ChEMBL compounds target EGFR with IC50 < 100nM, and which are in active clinical trials for NSCLC?",
  },
  {
    vague: "What does rs1042522 do?",
    specific:
      "Look up rs1042522 in ClinVar for clinical significance, then check Ensembl for variant consequences on TP53 transcripts",
  },
  {
    vague: "Analyze this protein",
    specific:
      "For UniProt P04637 (TP53), show protein domains, post-translational modifications, and known interaction partners",
  },
  {
    vague: "Any trials for Alzheimer's?",
    specific:
      "Find phase 3 clinical trials recruiting in the US for Alzheimer's disease with amyloid-targeting interventions",
  },
];

// ─── Prompt templates ─────────────────────────────────────────────────────────

export interface PromptTemplate {
  title: string;
  databases: string[];
  template: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    title: "Gene Deep Dive",
    databases: ["Ensembl", "UniProt", "ClinVar", "Reactome", "Open Targets"],
    template: `For the gene [GENE_SYMBOL]:
1. Use Ensembl to find the canonical transcript and Ensembl ID
2. Look up the protein in UniProt — show domains, PTMs, and interaction partners
3. Search ClinVar for pathogenic or likely-pathogenic variants
4. List Reactome pathways the protein participates in
5. Use Open Targets to show top associated diseases with evidence scores
Present results as a structured summary with all identifiers.`,
  },
  {
    title: "Drug Safety Profile",
    databases: ["ChEMBL", "PubChem", "Open Targets", "ClinicalTrials"],
    template: `For the compound [DRUG_NAME]:
1. Find the ChEMBL ID and retrieve known targets with activity data
2. Use PubChem to get toxicity, bioassay results, and safety data
3. Check Open Targets for disease associations of the primary target
4. Search ClinicalTrials for completed or active trials — note any safety signals
Summarize the safety profile with mechanistic rationale.`,
  },
  {
    title: "Variant Interpretation",
    databases: ["ClinVar", "Ensembl", "UniProt", "Open Targets", "PubMed"],
    template: `For variant [rsID or coordinates]:
1. Look up clinical significance in ClinVar (pathogenicity, submitters, conditions)
2. Get consequence predictions from Ensembl (impact on transcripts and protein)
3. Map to the protein in UniProt — which domain is affected?
4. Check Open Targets for disease associations of the affected gene
5. Find 3–5 key supporting publications in PubMed
Provide a clinical interpretation summary.`,
  },
  {
    title: "Target Druggability",
    databases: ["Open Targets", "ChEMBL", "UniProt", "ClinicalTrials"],
    template: `Assess the druggability of target [GENE_SYMBOL or ENSG ID]:
1. Use Open Targets to get disease evidence scores and known drugs
2. Pull ChEMBL bioactivity data — what compound classes exist, best potency?
3. Check UniProt for protein structure, binding pockets, and isoforms
4. Search ClinicalTrials for trials targeting this gene or pathway
Rate druggability as High/Medium/Low with supporting evidence.`,
  },
  {
    title: "Pharmacogenomic Check",
    databases: ["ClinPGx", "ClinVar", "ChEMBL", "PubMed"],
    template: `For patient genotype [GENE]*[ALLELE] (e.g. CYP2D6*4/*4):
1. Get CPIC/DPWG dosing guideline from ClinPGx
2. Confirm variant pathogenicity and functional impact in ClinVar
3. Look up alternative drugs with different metabolic pathways in ChEMBL
4. Find supporting pharmacogenomics literature in PubMed
Provide dosing recommendation and rationale.`,
  },
  {
    title: "Literature Review",
    databases: ["PubMed", "Open Targets", "ClinicalTrials"],
    template: `Compile a literature review on [TOPIC]:
1. Search PubMed for the 10 most-cited recent papers (last 3 years)
2. Use Open Targets to identify key targets implicated by the literature
3. Check ClinicalTrials for ongoing studies on high-priority targets
4. Summarize key themes, conflicting evidence, and open questions
Format as an annotated bibliography with a 200-word synthesis.`,
  },
];

// ─── Steering tips ────────────────────────────────────────────────────────────

export interface SteeringTip {
  number: number;
  title: string;
  description: string;
  example?: string;
}

export const STEERING_TIPS: SteeringTip[] = [
  {
    number: 1,
    title: "Name the database explicitly",
    description:
      'Say "Use ClinVar to check…" rather than just "check the variant." Naming the database routes the query directly and avoids ambiguity.',
    example: '✓ "Look up rs1042522 in ClinVar"\n✗ "Check what this variant means"',
  },
  {
    number: 2,
    title: "Provide identifiers when known",
    description:
      'Give database IDs whenever you have them. "for ENSG00000141510" is faster and more precise than "for the TP53 gene."',
    example: '✓ "Get protein data for UniProt P04637"\n✗ "Get data on the TP53 protein"',
  },
  {
    number: 3,
    title: "Request cross-references explicitly",
    description:
      'Ask the assistant to "map to UniProt" or "then find Reactome pathways." Cross-database chaining requires explicit instruction.',
    example:
      '✓ "Find the gene in Ensembl, then map to UniProt and list Reactome pathways"\n✗ "Tell me everything about BRCA1"',
  },
  {
    number: 4,
    title: "Control scope and filters",
    description:
      "Narrow results with filters: phase, status, organism, significance, potency thresholds.",
    example:
      '✓ "Phase 3 trials recruiting in the US for NSCLC"\n✗ "Find trials for lung cancer"',
  },
  {
    number: 5,
    title: "Ask for structured output",
    description:
      'Request tables, ranked lists, or summaries. "Present as a table with identifiers" dramatically improves readability.',
    example:
      '✓ "Return results as a table with columns: Gene, Variant, Significance, Condition"\n✗ "Show me the results"',
  },
];

// ─── Research workflows ───────────────────────────────────────────────────────

export interface WorkflowStep {
  database: string;
  action: string;
  color: string;
}

export interface Workflow {
  id: number;
  title: string;
  persona: string;
  personaColor: string;
  databases: string[];
  steps: WorkflowStep[];
  examplePrompt: string;
  whyValuable: string;
}

export const WORKFLOWS: Workflow[] = [
  {
    id: 1,
    title: "VUS-to-Therapy Interpretation",
    persona: "Clinical Geneticist",
    personaColor: "bg-red-100 text-red-800",
    databases: ["ClinVar", "Ensembl", "UniProt", "Reactome", "Open Targets", "ChEMBL", "ClinicalTrials", "PubMed"],
    steps: [
      { database: "ClinVar", action: "Clinical significance + phenotype", color: "bg-red-100 text-red-800 border-red-200" },
      { database: "Ensembl", action: "Consequence prediction + transcripts", color: "bg-violet-100 text-violet-800 border-violet-200" },
      { database: "UniProt", action: "Protein domain & function", color: "bg-blue-100 text-blue-800 border-blue-200" },
      { database: "Reactome", action: "Pathway context", color: "bg-pink-100 text-pink-800 border-pink-200" },
      { database: "Open Targets", action: "Disease evidence + drugs", color: "bg-orange-100 text-orange-800 border-orange-200" },
      { database: "ChEMBL", action: "Compound modulators", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
      { database: "ClinicalTrials", action: "Matched trials", color: "bg-teal-100 text-teal-800 border-teal-200" },
      { database: "PubMed", action: "Supporting literature", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
    ],
    examplePrompt: `A patient has variant rs28934578 in BRCA2. Look up its clinical significance in ClinVar, get Ensembl consequence predictions, check UniProt for the affected protein domain, find relevant Reactome pathways, use Open Targets to list disease associations and known drugs, search ChEMBL for PARP inhibitors active against BRCA2-deficient tumors, find recruiting clinical trials matching this variant, and compile key supporting literature from PubMed. Present as a clinical summary.`,
    whyValuable: "Compresses multi-day manual interpretation into minutes and increases consistency of actionable recommendations.",
  },
  {
    id: 2,
    title: "Disease-to-Target Prioritization",
    persona: "Drug Discovery Scientist",
    personaColor: "bg-orange-100 text-orange-800",
    databases: ["Open Targets", "ClinVar", "Ensembl", "UniProt", "Reactome", "ChEMBL", "PubMed"],
    steps: [
      { database: "Open Targets", action: "Disease-associated genes + scores", color: "bg-orange-100 text-orange-800 border-orange-200" },
      { database: "ClinVar", action: "Pathogenic variants in top genes", color: "bg-red-100 text-red-800 border-red-200" },
      { database: "Ensembl", action: "Gene models + orthologs", color: "bg-violet-100 text-violet-800 border-violet-200" },
      { database: "UniProt", action: "Functional annotations", color: "bg-blue-100 text-blue-800 border-blue-200" },
      { database: "Reactome", action: "Pathway coherence", color: "bg-pink-100 text-pink-800 border-pink-200" },
      { database: "ChEMBL", action: "Bioactivity + ligandability", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
      { database: "PubMed", action: "Key publications", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
    ],
    examplePrompt: `For Parkinson's disease, use Open Targets to retrieve the top 10 disease-associated genes by genetic evidence score. For the top 3 genes, check ClinVar for pathogenic variants, get Ensembl gene models and human orthologs, pull UniProt functional annotations, find Reactome pathways they share, and retrieve ChEMBL bioactivity data. Rank targets by combined evidence and present as a prioritization table with druggability assessment.`,
    whyValuable: "Produces defensible, evidence-weighted target lists and reduces target vetting cycles from weeks to hours.",
  },
  {
    id: 3,
    title: "Pathway-Driven Drug Repurposing",
    persona: "Repurposing Scientist",
    personaColor: "bg-pink-100 text-pink-800",
    databases: ["Reactome", "Open Targets", "ChEMBL", "PubChem", "ClinicalTrials", "PubMed"],
    steps: [
      { database: "Reactome", action: "Disease-relevant pathways", color: "bg-pink-100 text-pink-800 border-pink-200" },
      { database: "Open Targets", action: "Score pathway genes vs disease", color: "bg-orange-100 text-orange-800 border-orange-200" },
      { database: "ChEMBL", action: "Known compounds for top targets", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
      { database: "PubChem", action: "Confirm structures + assays", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
      { database: "ClinicalTrials", action: "Past/ongoing trials", color: "bg-teal-100 text-teal-800 border-teal-200" },
      { database: "PubMed", action: "Mechanistic support", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
    ],
    examplePrompt: `For ALS (amyotrophic lateral sclerosis), find the top 5 disease-relevant pathways in Reactome. Use Open Targets to score the pathway genes against ALS evidence. For the top 3 scored genes, retrieve existing ChEMBL compounds with sub-micromolar potency, confirm structures and bioassay data in PubChem, check ClinicalTrials for any past or current trials, and summarize mechanistic support from PubMed. Output a repurposing shortlist with feasibility rating.`,
    whyValuable: "Cuts repurposing discovery time and improves confidence by linking mechanism to clinical feasibility.",
  },
  {
    id: 4,
    title: "Pharmacogenomic Dosing",
    persona: "Clinical Pharmacologist",
    personaColor: "bg-amber-100 text-amber-800",
    databases: ["ClinPGx", "ClinVar", "Ensembl", "UniProt", "ChEMBL", "PubChem", "PubMed"],
    steps: [
      { database: "ClinPGx", action: "Guideline recommendations", color: "bg-amber-100 text-amber-800 border-amber-200" },
      { database: "ClinVar", action: "Variant consequence mapping", color: "bg-red-100 text-red-800 border-red-200" },
      { database: "Ensembl", action: "Confirm variant consequences", color: "bg-violet-100 text-violet-800 border-violet-200" },
      { database: "UniProt", action: "Enzyme functional impact", color: "bg-blue-100 text-blue-800 border-blue-200" },
      { database: "ChEMBL", action: "Alternative compounds", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
      { database: "PubChem", action: "Validate properties + assays", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
      { database: "PubMed", action: "Supporting evidence", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
    ],
    examplePrompt: `Patient genotype: CYP2D6*4/*4 (poor metabolizer). Get CPIC dosing guidance for codeine from ClinPGx. Confirm the CYP2D6 variant in ClinVar and get Ensembl consequence predictions. Look up the CYP2D6 enzyme in UniProt to understand the functional impact. Identify alternative opioid analgesics with different metabolic pathways in ChEMBL. Validate the alternatives' safety properties in PubChem. Summarize with PubMed evidence for the recommended alternative.`,
    whyValuable: "Reduces adverse events and improves therapeutic efficacy — particularly critical for drugs with narrow therapeutic indices.",
  },
  {
    id: 5,
    title: "Off-Target Safety Assessment",
    persona: "Safety Pharmacologist",
    personaColor: "bg-rose-100 text-rose-800",
    databases: ["ChEMBL", "PubChem", "UniProt", "Reactome", "ClinVar", "PubMed", "ClinicalTrials"],
    steps: [
      { database: "ChEMBL", action: "Known + predicted off-targets", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
      { database: "PubChem", action: "Toxicity + bioassay signals", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
      { database: "UniProt", action: "Target function annotation", color: "bg-blue-100 text-blue-800 border-blue-200" },
      { database: "Reactome", action: "Risk pathway mapping", color: "bg-pink-100 text-pink-800 border-pink-200" },
      { database: "ClinVar", action: "Sensitive genes in pathways", color: "bg-red-100 text-red-800 border-red-200" },
      { database: "PubMed", action: "Adverse event signals", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
      { database: "ClinicalTrials", action: "Trial safety reports", color: "bg-teal-100 text-teal-800 border-teal-200" },
    ],
    examplePrompt: `For lead compound CHEMBL1234567 (a kinase inhibitor): Use ChEMBL to enumerate known and predicted off-targets with IC50 < 1μM. Pull PubChem toxicity and AMES mutagenicity data. Annotate each off-target using UniProt for function. Map off-targets to Reactome pathways and flag safety-relevant pathways (cardiac ion channels, liver enzymes). Check ClinVar for pathogenic variants in those pathway genes. Search PubMed for adverse event reports and ClinicalTrials for safety findings. Output a structured safety risk matrix.`,
    whyValuable: "Identifies safety liabilities early in the discovery process, preventing costly late-stage failures.",
  },
  {
    id: 6,
    title: "Biomarker-Driven Trial Matching",
    persona: "Oncologist",
    personaColor: "bg-teal-100 text-teal-800",
    databases: ["ClinVar", "Ensembl", "Open Targets", "ClinicalTrials", "PubMed", "ClinPGx"],
    steps: [
      { database: "ClinVar", action: "Variant → gene mapping", color: "bg-red-100 text-red-800 border-red-200" },
      { database: "Ensembl", action: "Consequence + gene ID", color: "bg-violet-100 text-violet-800 border-violet-200" },
      { database: "Open Targets", action: "Drugs + disease hypotheses", color: "bg-orange-100 text-orange-800 border-orange-200" },
      { database: "ClinicalTrials", action: "Recruiting trial matches", color: "bg-teal-100 text-teal-800 border-teal-200" },
      { database: "PubMed", action: "Evidence + outcomes", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
      { database: "ClinPGx", action: "PGx contraindications", color: "bg-amber-100 text-amber-800 border-amber-200" },
    ],
    examplePrompt: `Patient has KRAS G12C mutation (confirmed pathogenic in ClinVar). Use Ensembl to confirm variant consequence on KRAS transcripts. Check Open Targets for approved or investigational drugs targeting KRAS G12C. Search ClinicalTrials for currently recruiting phase 2/3 trials for KRAS G12C NSCLC patients. Validate evidence and outcomes via PubMed. Check ClinPGx for any pharmacogenomic contraindications with candidate drugs. Present a ranked list of matching trials with eligibility criteria summary.`,
    whyValuable: "Increases clinical trial access for rare-variant patients and reduces time-to-match from days to under 30 minutes.",
  },
  {
    id: 7,
    title: "Investment Evidence Package",
    persona: "Portfolio Strategist",
    personaColor: "bg-blue-100 text-blue-800",
    databases: ["UniProt", "Open Targets", "Reactome", "ChEMBL", "PubChem", "ClinicalTrials", "PubMed"],
    steps: [
      { database: "UniProt", action: "Protein biology + annotations", color: "bg-blue-100 text-blue-800 border-blue-200" },
      { database: "Open Targets", action: "Disease relevance scoring", color: "bg-orange-100 text-orange-800 border-orange-200" },
      { database: "Reactome", action: "Pathway context", color: "bg-pink-100 text-pink-800 border-pink-200" },
      { database: "ChEMBL", action: "Bioactivity + selectivity", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
      { database: "PubChem", action: "Chemical properties + assays", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
      { database: "ClinicalTrials", action: "Clinical development status", color: "bg-teal-100 text-teal-800 border-teal-200" },
      { database: "PubMed", action: "Key literature", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
    ],
    examplePrompt: `Build an investment evidence package for CDK4/6 inhibitors targeting pancreatic cancer. Pull CDK4 and CDK6 protein biology from UniProt. Score pancreatic cancer evidence from Open Targets. Map CDK4/6 to Reactome pathways to understand mechanism. Retrieve ChEMBL bioactivity for the top 5 CDK4/6 inhibitors (potency, selectivity). Confirm ADMET properties in PubChem. Show ClinicalTrials development landscape — phases, sponsors, recent completions. Compile 10 key publications from PubMed. Output an executive summary suitable for a portfolio committee.`,
    whyValuable: "Accelerates go/no-go investment decisions and reduces costly misprioritization by surfacing cross-silo evidence in one place.",
  },
];

// ─── ID mapping reference ─────────────────────────────────────────────────────

export interface IdMappingRow {
  mapping: string;
  startingWith: string;
  tool: string;
  example: string;
  note?: string;
}

export const ID_MAPPINGS: IdMappingRow[] = [
  {
    mapping: "Gene → Ensembl ID",
    startingWith: "Gene symbol (BRCA1, TP53)",
    tool: 'ensembl__search_genes("BRCA1")',
    example: "Returns ENSG00000012048",
    note: "Use search_genes, not lookup_gene (which requires ENSG ID)",
  },
  {
    mapping: "Gene → UniProt",
    startingWith: "Gene symbol (TP53)",
    tool: 'uniprot__search_by_gene("TP53", reviewed=true)',
    example: "Returns P04637",
    note: "Always use reviewed=true for Swiss-Prot curated entries",
  },
  {
    mapping: "Drug → ChEMBL",
    startingWith: "Drug name (imatinib)",
    tool: 'chembl__search_compounds("imatinib")',
    example: "Returns CHEMBL941",
  },
  {
    mapping: "Variant → Gene",
    startingWith: "rsID (rs1042522)",
    tool: 'clinvar__lookup_by_rsid("rs1042522")',
    example: "Returns TP53 + clinical significance",
  },
  {
    mapping: "Structure → CID",
    startingWith: "SMILES string",
    tool: "pubchem__search_by_smiles(smiles=...)",
    example: "Returns PubChem CID",
  },
  {
    mapping: "UniProt → Ensembl",
    startingWith: "UniProt accession (P04637)",
    tool: 'uniprot__get_external_references("P04637")',
    example: "Returns ENSG00000141510",
  },
  {
    mapping: "Ensembl → UniProt",
    startingWith: "Ensembl gene ID (ENSG00000141510)",
    tool: 'ensembl__get_xrefs("ENSG00000141510")',
    example: "Look for Uniprot_gn entries",
  },
  {
    mapping: "Variant consequences",
    startingWith: "rsID or genomic coords",
    tool: 'ensembl__get_variant_consequences("rs1042522")',
    example: "Returns transcript impact (missense, splice, etc.)",
  },
];

// ─── Tips ─────────────────────────────────────────────────────────────────────

export interface Tip {
  icon: string; // lucide icon name
  title: string;
  description: string;
}

export const TIPS: Tip[] = [
  {
    icon: "Target",
    title: "Name the Database",
    description:
      'Specify which database to query. "Use ClinVar to check…" routes the query precisely and avoids the AI guessing.',
  },
  {
    icon: "Key",
    title: "Provide Known IDs",
    description:
      "Give identifiers when you have them — Ensembl IDs, UniProt accessions, ChEMBL IDs — for faster, more accurate results.",
  },
  {
    icon: "GitBranch",
    title: "Request Cross-References",
    description:
      "Explicitly ask to link data across databases. Cross-database chaining requires instruction — it won't happen automatically.",
  },
  {
    icon: "LayoutList",
    title: "Specify Output Format",
    description:
      'Request tables, ranked lists, or structured summaries. "Present as a table with columns: Gene, Variant, Significance" is much better than "show me results."',
  },
  {
    icon: "MessageSquarePlus",
    title: "Iterate & Drill Down",
    description:
      "Start with a broad query to orient yourself, then follow up with specific questions. Multi-turn conversations work well with BURP.",
  },
  {
    icon: "Layers",
    title: "Combine Databases",
    description:
      "Ask for multi-database integrated answers in one prompt. BURP can query 5–8 databases in a single response.",
  },
];

// ─── Limitations ──────────────────────────────────────────────────────────────

export interface Limitation {
  icon: string;
  title: string;
  description: string;
  variant: "default" | "destructive";
}

export const LIMITATIONS: Limitation[] = [
  {
    icon: "Info",
    title: "Daily Quotas",
    description:
      "Each account has daily query and token limits. Limits reset at midnight UTC. Contact your admin if you need increased quotas.",
    variant: "default",
  },
  {
    icon: "Clock",
    title: "Response Time",
    description:
      "Complex multi-database queries may take 30–60 seconds. The assistant is running multiple API calls in parallel — please wait for the full response.",
    variant: "default",
  },
  {
    icon: "RefreshCw",
    title: "Live Data",
    description:
      "BURP queries live database APIs. Results reflect the current state of each database and may differ from cached or older snapshots.",
    variant: "default",
  },
  {
    icon: "AlertTriangle",
    title: "No Bulk Export",
    description:
      "BURP is designed for targeted, targeted queries — not mass downloads. For bulk data, use the databases' own FTP/download portals.",
    variant: "destructive",
  },
  {
    icon: "FileBox",
    title: "Large Results",
    description:
      "Very large result sets are stored as inspectable artifacts in the conversation. Use the artifact viewer to explore them fully.",
    variant: "default",
  },
];

// ─── TOC sections ─────────────────────────────────────────────────────────────

export interface TocSection {
  id: string;
  label: string;
}

export const TOC_SECTIONS: TocSection[] = [
  { id: "databases", label: "Database Overview" },
  { id: "prompts", label: "Writing Prompts" },
  { id: "workflows", label: "Research Workflows" },
  { id: "connections", label: "Connection Map" },
  { id: "id-mapping", label: "ID Mapping" },
  { id: "tips", label: "Tips & Best Practices" },
  { id: "limitations", label: "Limitations" },
];
