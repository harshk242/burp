# BURP: High-Value Cross-Platform Use Cases

This document defines research and clinical use cases that stress-test cross-platform federation across the integrated MCP servers.

## Overview Table

| # | Use case | Target user persona | Platforms involved | Core research question | Success signal |
| --- | --- | --- | --- | --- | --- |
| 1 | VUS-to-therapy interpretation for a rare cancer patient | Clinical geneticist / molecular tumor board | ClinVar, Ensembl, UniProt, Reactome, Open Targets, ChEMBL, ClinicalTrials.gov, PubMed | What is the functional impact of this variant and are there actionable therapies or trials? | Time-to-report under 10 minutes; concordant with expert board |
| 2 | Disease-to-target prioritization with druggability evidence | Translational researcher / drug discovery scientist | Open Targets, ClinVar, Ensembl, UniProt, Reactome, ChEMBL, PubMed | Which genes should be prioritized for a disease program based on multi-source evidence? | Ranked list with full evidence provenance; % targets with bioactivity support |
| 3 | Pathway-driven drug repurposing shortlist | Drug repurposing scientist | Reactome, Open Targets, ChEMBL, PubChem, ClinicalTrials.gov, PubMed | Which existing compounds modulate disease-relevant pathways with clinical feasibility? | Viable shortlist with trial evidence; time-to-shortlist under 1 day |
| 4 | Pharmacogenomic dosing and alternative selection | Clinical pharmacologist / precision medicine pharmacist | ClinPGx, ClinVar, Ensembl, UniProt, ChEMBL, PubChem, PubMed | Given a genotype, what dosing guidance or alternative therapy is optimal? | Concordance with CPIC/DPWG; reduced time to dosing decision |
| 5 | Off-target safety risk assessment for a lead compound | Safety pharmacologist / preclinical lead | ChEMBL, PubChem, UniProt, Reactome, ClinVar, PubMed, ClinicalTrials.gov | What off-targets and pathways could drive adverse events for this compound? | Mechanistically plausible AE hypotheses with evidence; faster risk review |
| 6 | Biomarker-driven trial matching for rare variants | Oncologist / clinical trial coordinator | ClinVar, Ensembl, Open Targets, ClinicalTrials.gov, PubMed, ClinPGx | Which recruiting trials match a patient variant or target? | Verified trial matches; time-to-match under 30 minutes |
| 7 | Decision-ready evidence package for target–compound investment | Portfolio committee / product strategist | UniProt, Open Targets, Reactome, ChEMBL, PubChem, ClinicalTrials.gov, PubMed | Is this target–compound pair supported by biology, druggability, and clinical evidence? | Evidence coverage across silos; time-to-memo under 1 day |

## Use Cases

1. **VUS-to-therapy interpretation for a rare cancer patient**
   - **Target user persona:** Clinical geneticist / molecular tumor board
   - **Core research question:** What is the functional impact of this variant and are there actionable therapies or trials?
   - **Current pain point:** Variant interpretation and therapy search require manual hops across ClinVar, Ensembl, protein annotations, pathway context, drug databases, and trial registries; evidence is inconsistent and slow to assemble.
   - **Platforms involved:** ClinVar, Ensembl, UniProt, Reactome, Open Targets, ChEMBL, ClinicalTrials.gov, PubMed
   - **Cross-platform workflow:**
     1) Start with rsID or coordinates in ClinVar to capture clinical significance and phenotype.
     2) Use Ensembl for consequence prediction, transcripts, and gene mapping.
     3) Pull UniProt domain/function annotations and Reactome pathways for mechanistic context.
     4) Use Open Targets to score gene–disease evidence and surface related drugs.
     5) Query ChEMBL for modulators of the target or pathway members.
     6) Find genotype- or target-matched trials in ClinicalTrials.gov.
     7) Compile supporting literature via PubMed.
   - **Why this is high-value:** Compresses multi-day manual interpretation into minutes and increases consistency of actionable recommendations.
   - **Success signal / evaluation metric:** Time-to-report under 10 minutes; concordance with expert tumor board decisions; number of actionable trials surfaced per case.

2. **Disease-to-target prioritization with druggability evidence**
   - **Target user persona:** Translational researcher / drug discovery scientist
   - **Core research question:** Which genes should be prioritized for a disease program based on genetics, biology, and druggability?
   - **Current pain point:** Evidence is fragmented across association scores, variant databases, protein annotations, and bioactivity sources; prioritization often relies on partial views.
   - **Platforms involved:** Open Targets, ClinVar, Ensembl, UniProt, Reactome, ChEMBL, PubMed
   - **Cross-platform workflow:**
     1) Use Open Targets to pull disease-associated genes with evidence scores.
     2) Cross-check ClinVar for pathogenic variants in those genes.
     3) Map gene models and orthologs via Ensembl.
     4) Enrich with UniProt functional annotations and Reactome pathway coherence.
     5) Pull ChEMBL bioactivity and ligandability signals.
     6) Validate key claims with PubMed.
   - **Why this is high-value:** Produces defensible, evidence-weighted target lists and reduces target vetting cycles.
   - **Success signal / evaluation metric:** Ranked list with complete evidence provenance; percentage of targets with bioactivity support; reduction in prioritization time from weeks to hours.

3. **Pathway-driven drug repurposing shortlist**
   - **Target user persona:** Drug repurposing scientist
   - **Core research question:** Which existing compounds can modulate disease-relevant pathways with clinical feasibility?
   - **Current pain point:** Mapping pathways to targets and then to compounds and trials is a manual, error-prone process.
   - **Platforms involved:** Reactome, Open Targets, ChEMBL, PubChem, ClinicalTrials.gov, PubMed
   - **Cross-platform workflow:**
     1) Start with disease-relevant pathways in Reactome.
     2) Score pathway genes against disease evidence in Open Targets.
     3) Pull known compounds for high-scoring targets from ChEMBL.
     4) Use PubChem to confirm structures and assay signals.
     5) Check ClinicalTrials.gov for past or ongoing trials.
     6) Summarize mechanistic support via PubMed.
   - **Why this is high-value:** Cuts repurposing discovery time and improves confidence by linking mechanism to clinical feasibility.
   - **Success signal / evaluation metric:** Number of viable repurposing candidates with trial feasibility evidence; time-to-shortlist under 1 day.

4. **Pharmacogenomic dosing and alternative selection**
   - **Target user persona:** Clinical pharmacologist / precision medicine pharmacist
   - **Core research question:** Given a patient genotype, what dosing guidance or alternative therapy is optimal?
   - **Current pain point:** Clinicians must manually reconcile genotype interpretation, dosing guidelines, and alternative drug options.
   - **Platforms involved:** ClinPGx, ClinVar, Ensembl, UniProt, ChEMBL, PubChem, PubMed
   - **Cross-platform workflow:**
     1) Start with genotype or star allele in ClinPGx for guideline recommendations.
     2) Use ClinVar and Ensembl to map variants and confirm consequences.
     3) Use UniProt to interpret functional impact on enzymes or transporters.
     4) Identify alternative compounds and targets in ChEMBL.
     5) Validate properties and assay evidence via PubChem.
     6) Pull supporting evidence from PubMed.
   - **Why this is high-value:** Reduces adverse events and improves therapeutic efficacy in a clinically actionable timeframe.
   - **Success signal / evaluation metric:** Concordance with CPIC/DPWG recommendations; reduced time to dosing decision; percentage of alternatives with documented evidence.

5. **Off-target safety risk assessment for a lead compound**
   - **Target user persona:** Safety pharmacologist / preclinical lead
   - **Core research question:** What off-targets and pathways could plausibly drive adverse events for this compound?
   - **Current pain point:** Off-target identification and mechanistic interpretation require stitching together multiple data silos.
   - **Platforms involved:** ChEMBL, PubChem, UniProt, Reactome, ClinVar, PubMed, ClinicalTrials.gov
   - **Cross-platform workflow:**
     1) Use ChEMBL to enumerate known and predicted off-targets with activity data.
     2) Pull toxicity and bioassay signals from PubChem.
     3) Annotate target functions via UniProt.
     4) Map targets to pathways in Reactome to identify risk mechanisms.
     5) Check ClinVar for clinically sensitive genes in those pathways.
     6) Validate adverse-event signals in PubMed and trial reports in ClinicalTrials.gov.
   - **Why this is high-value:** Identifies safety liabilities early and prevents late-stage failures.
   - **Success signal / evaluation metric:** Number of mechanistically plausible adverse-event hypotheses with evidence; reduction in time to safety assessment.

6. **Biomarker-driven trial matching for rare variants**
   - **Target user persona:** Oncologist / clinical trial coordinator
   - **Core research question:** Which recruiting trials match a patient variant or target?
   - **Current pain point:** Trial eligibility is hard to search by genotype; manual matching is slow and inconsistent.
   - **Platforms involved:** ClinVar, Ensembl, Open Targets, ClinicalTrials.gov, PubMed, ClinPGx
   - **Cross-platform workflow:**
     1) Map patient variant to gene and consequence with ClinVar and Ensembl.
     2) Use Open Targets to identify drugs and hypotheses linked to the gene or disease.
     3) Query ClinicalTrials.gov by gene, drug, or condition to find recruiting studies.
     4) Validate evidence and outcomes via PubMed.
     5) Flag pharmacogenomic contraindications in ClinPGx.
   - **Why this is high-value:** Increases trial access for rare-variant patients and streamlines enrollment.
   - **Success signal / evaluation metric:** Percentage of true-positive trial matches verified by eligibility criteria; time-to-match under 30 minutes.

7. **Decision-ready evidence package for target–compound investment**
   - **Target user persona:** Portfolio committee / product strategist
   - **Core research question:** Is this target–compound pair supported by sufficient biology, druggability, and clinical evidence to invest?
   - **Current pain point:** Evidence aggregation across biology, chemistry, and clinical data takes weeks and is inconsistent.
   - **Platforms involved:** UniProt, Open Targets, Reactome, ChEMBL, PubChem, ClinicalTrials.gov, PubMed
   - **Cross-platform workflow:**
     1) Pull protein biology and annotations from UniProt.
     2) Score disease relevance with Open Targets.
     3) Place target in pathway context via Reactome.
     4) Collect bioactivity and selectivity data from ChEMBL.
     5) Confirm chemical properties and assay evidence in PubChem.
     6) Review clinical development status in ClinicalTrials.gov.
     7) Compile key literature from PubMed.
   - **Why this is high-value:** Accelerates go/no-go decisions and reduces costly misprioritization.
   - **Success signal / evaluation metric:** Evidence coverage across all silos; time-to-investment memo under 1 day; stakeholder agreement on decision readiness.
