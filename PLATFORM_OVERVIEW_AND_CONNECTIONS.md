# Super Bio Agent: Comprehensive Platform Overview & Connection Guide

## Table of Contents
1. [Platform Overview](#platform-overview)
2. [All Connection Permutations](#all-connection-permutations)
3. [Connection Matrix](#connection-matrix-all-permutations)
4. [Example Workflows](#example-workflows-across-multiple-platforms)
5. [Key Insights](#key-insights)

---

## Platform Overview

### 1. ChEMBL 💊
**Purpose**: Chemical biology database with 2M+ bioactive compounds
**Data**: Compound structures, bioactivity assays, targets, drug development phases, ADMET properties
**Use Cases**: Drug discovery, compound optimization, SAR analysis, mechanism of action
**Key Tools**: 27 tools across chemical search, target analysis, bioactivity, drug info, ADMET prediction

---

### 2. UniProt 🧬
**Purpose**: Central protein sequence and annotation repository with 27M+ proteins
**Data**: Protein sequences, functional annotations, disease associations, cross-references to 500+ databases
**Use Cases**: Protein function analysis, evolutionary studies (orthologs/homologs), disease discovery
**Key Tools**: 26 tools for protein analysis, comparative genomics, domains, pathways, interactions

---

### 3. Ensembl 🧪
**Purpose**: Genomic sequences and gene annotations for 200+ species
**Data**: Gene structures, transcripts, exons, variants, regulatory features, comparative genomics
**Use Cases**: Gene annotation, variant consequence prediction, comparative genomics, genomic coordinate mapping
**Key Tools**: 25 tools for genes, sequences, variants, homologs, regulatory features

---

### 4. PubChem 🧪
**Purpose**: Chemical compound database with 110M+ compounds (NCBI)
**Data**: Chemical structures, 2D/3D conformers, bioassay results, toxicity, patents, safety data
**Use Cases**: Chemical property screening, bioassay mining, drug-likeness prediction, safety assessment
**Key Tools**: 24 tools for chemical search, structure analysis, properties, bioassays, safety/toxicity

---

### 5. Open Targets 🎯
**Purpose**: Integrates target-disease-drug associations (24+ evidence sources)
**Data**: Target-disease scores, drug mechanisms, genetic variants, clinical trials, literature evidence
**Use Cases**: Target prioritization, drug repurposing, clinical validation, genetic variant interpretation
**Key Tools**: 45+ tools—the **most interconnected platform** (hub linking all others)

---

### 6. Reactome 🛣️
**Purpose**: Manually curated biological pathway database
**Data**: 2,500+ pathways, 25K reactions, pathway participants, protein interactions
**Use Cases**: Pathway enrichment, drug-pathway analysis, off-target prediction, systems biology
**Key Tools**: 8 tools for pathway search, hierarchy, participants, reactions, interactions

---

### 7. ClinVar 🔬
**Purpose**: Genetic variant-phenotype relationship database with 1.2M variants
**Data**: Clinical significance interpretations, submitter reviews, population frequencies, disease associations
**Use Cases**: Variant pathogenicity assessment, clinical interpretation, population analysis
**Key Tools**: 12 tools for variant lookup, clinical significance, submissions, frequency

---

### 8. ClinicalTrials 🏥
**Purpose**: Registry of 400K+ clinical trials from 220+ countries
**Data**: Trial status, eligibility criteria, outcomes, locations, sponsors, conditions
**Use Cases**: Clinical validation of targets/drugs, patient recruitment, competitive landscape, trial outcome analysis
**Key Tools**: 18 tools for trial search, recruiting status, outcomes, eligibility, timeline

---

### 9. PubMed 📚
**Purpose**: Biomedical literature database with 35M+ citations (NCBI)
**Data**: Journal articles, abstracts, MeSH indexing, citations, author networks
**Use Cases**: Literature discovery, evidence base construction, citation networks, publication trends
**Key Tools**: 13 tools for search, fetch articles, citations, MeSH terms, trends

---

### 10. ClinPGx (PharmGKB) 💊🧬
**Purpose**: Pharmacogenomics database linking genes to drug response
**Data**: Gene-drug interactions, star alleles, dosing guidelines (CPIC/DPWG), clinical annotations
**Use Cases**: Personalized medicine, precision dosing, drug response prediction, adverse event risk
**Key Tools**: 16 tools for genes, drugs, variants, clinical annotations, dosing guidelines

---

## All Connection Permutations

### Bidirectional Connections (Can go both directions)

```
1. ChEMBL ↔ UniProt
   └─ Mapping: ChEMBL target ID ↔ UniProt accession (e.g., CHEMBL2093875 ↔ P04637)
   └─ Tool: ChEMBL.search_by_uniprot()
   └─ Use: Find compounds for protein or protein function for compound

2. ChEMBL ↔ PubChem
   └─ Mapping: ChEMBL ID ↔ PubChem CID via InChI/SMILES/CAS (e.g., CHEMBL25 ↔ 2244)
   └─ Tool: External references in both databases
   └─ Use: Cross-database compound validation

3. ChEMBL ↔ Open Targets
   └─ Mapping: ChEMBL_ID + Ensembl gene ID for target-compound-disease
   └─ Tool: OT.get_target_known_drugs() / ChEMBL compounds for targets
   └─ Use: Drug repurposing, target validation with compounds

4. ChEMBL ↔ Reactome
   └─ Mapping: Compounds affect proteins in pathways (via gene symbol)
   └─ Tool: Reactome pathways ↔ ChEMBL compound targets
   └─ Use: Pathway-level drug effect analysis, off-target prediction

5. ChEMBL ↔ ClinPGx
   └─ Mapping: Pharmacogenomic genes and compound interactions
   └─ Tool: ClinPGx.get_drug_gene_interactions()
   └─ Use: Precision dosing and personalized medicine

6. UniProt ↔ Ensembl
   └─ Mapping: UniProt accession ↔ Gene symbol ↔ Ensembl gene ID (e.g., P04637 ↔ TP53 ↔ ENSG00000141510)
   └─ Tool: UniProt.get_external_references() / Ensembl.get_xrefs()
   └─ Use: Bridge between protein and genomic data

7. UniProt ↔ Reactome
   └─ Mapping: Protein UniProt ID → Pathway membership
   └─ Tool: UniProt.get_protein_pathways() / Reactome.find_pathways_by_gene()
   └─ Use: Functional annotation and pathway analysis

8. UniProt ↔ Open Targets
   └─ Mapping: UniProt accession ↔ Ensembl gene ID ↔ Disease association
   └─ Tool: OT uses Ensembl IDs; UniProt provides protein-level detail
   └─ Use: Protein function in disease context

9. Ensembl ↔ ClinVar
   └─ Mapping: Genomic coordinates and gene names (e.g., chr17:43044295 ↔ rs1042522 ↔ TP53)
   └─ Tool: Ensembl.get_variant_consequences() / ClinVar.lookup_by_coordinates()
   └─ Use: Variant interpretation and consequence prediction

10. Ensembl ↔ Reactome
    └─ Mapping: Gene symbol → Pathway membership
    └─ Tool: Reactome.find_pathways_by_gene() using Ensembl genes
    └─ Use: Genomic variant in pathway context

11. PubChem ↔ ChEMBL
    └─ Already covered (see #2)

12. Open Targets ↔ ChEMBL
    └─ Already covered (see #3)

13. Open Targets ↔ UniProt
    └─ Already covered (see #8)

14. Open Targets ↔ Ensembl
    └─ Mapping: Ensembl gene ID is PRIMARY identifier for Open Targets
    └─ Tool: All OT target queries use ENSG format
    └─ Use: All target-level queries

15. ClinicalTrials ↔ PubMed
    └─ Mapping: Trial ID (NCT) → Published results (PMID)
    └─ Tool: ClinicalTrials.get_studies_with_results()
    └─ Use: Finding published trial outcomes

16. ClinPGx ↔ UniProt
    └─ Mapping: Gene symbol (e.g., CYP2D6) ↔ UniProt accession
    └─ Tool: ClinPGx.get_gene_info() links to protein annotations
    └─ Use: Gene function and protein-level pharmacogenomics
```

---

### Unidirectional Connections (One-way only)

```
1. Open Targets → ClinVar
   └─ Flow: OT integrates ClinVar evidence for target-disease associations
   └─ Mapping: Variant ID → Gene ID → Disease association strength
   └─ Use: Genetic evidence for target validation

2. Open Targets → ClinicalTrials
   └─ Flow: OT retrieves clinical trial data for target-disease validation
   └─ Mapping: Gene/drug name → NCT trial searches
   └─ Use: Clinical validation evidence for targets

3. Open Targets → PubMed
   └─ Flow: OT shows literature co-occurrence for target-disease pairs
   └─ Tool: OT.get_target_literature_occurrences()
   └─ Use: Publication evidence for associations

4. ChEMBL → PubMed
   └─ Flow: ChEMBL links compounds/targets to supporting literature
   └─ Mapping: Compound/target ID → PMID
   └─ Use: Evidence base for bioactivity data

5. UniProt → PubMed
   └─ Flow: UniProt links protein entries to literature
   └─ Mapping: UniProt ID → PMID
   └─ Use: Protein function support evidence

6. Ensembl → PubMed
   └─ Flow: Gene/variant publications
   └─ Mapping: Gene/variant → PMID
   └─ Use: Genomic discovery literature

7. PubChem → PubMed
   └─ Flow: Compounds link to bioassay and chemical literature
   └─ Mapping: CID → PMID
   └─ Use: Chemical property and bioactivity literature

8. Reactome → (all others) via PubMed
   └─ Flow: Pathway publications link to other databases
   └─ Use: Pathway literature support
```

---

## Connection Matrix: All Permutations

| **From** | **To** | **Type** | **Key Mapping** | **Primary Tool** |
|----------|--------|----------|-----------------|------------------|
| ChEMBL | UniProt | ↔ | ChEMBL_ID ↔ Accession | search_by_uniprot |
| ChEMBL | PubChem | ↔ | InChI/SMILES/CAS | External refs |
| ChEMBL | Open Targets | ↔ | ChEMBL_ID + ENSG | get_known_drugs |
| ChEMBL | Reactome | ↔ | Gene symbol | Pathway members |
| ChEMBL | ClinPGx | ↔ | Gene-drug pairs | get_guidelines |
| ChEMBL | PubMed | → | Compound → PMID | External refs |
| UniProt | Ensembl | ↔ | Accession ↔ ENSG | get_external_references |
| UniProt | Reactome | ↔ | UniProt ID → Pathway | get_protein_pathways |
| UniProt | Open Targets | ↔ | Accession ↔ ENSG | Target info |
| UniProt | ChEMBL | ↔ | Target accession | External refs |
| UniProt | PubMed | → | Protein → PMID | Literature refs |
| Ensembl | ClinVar | ↔ | Coordinates ↔ rsID | get_variants |
| Ensembl | Reactome | ↔ | Gene symbol → Pathway | find_pathways_by_gene |
| Ensembl | Open Targets | ↔ | ENSG (foundational) | Target queries |
| Ensembl | UniProt | ↔ | ENSG ↔ Accession | get_xrefs |
| Ensembl | PubMed | → | Gene → PMID | Literature |
| PubChem | ChEMBL | ↔ | CID ↔ ChEMBL_ID | External refs |
| PubChem | PubMed | → | CID → PMID | Literature refs |
| Open Targets | ChEMBL | ↔ | ENSG + ChEMBL_ID | get_known_drugs |
| Open Targets | UniProt | ↔ | ENSG ↔ Accession | Target info |
| Open Targets | Ensembl | ↔ | ENSG (primary) | All queries |
| Open Targets | ClinVar | → | Variant → Disease | genetic_evidence |
| Open Targets | ClinicalTrials | → | Gene/Drug → NCT | Clinical evidence |
| Open Targets | PubMed | → | Target → PMID | Literature |
| Reactome | UniProt | ↔ | Protein in pathway | Participants |
| Reactome | Ensembl | ↔ | Gene in pathway | find_pathways |
| Reactome | ChEMBL | ↔ | Target in pathway | Interactions |
| ClinVar | Ensembl | ↔ | Variant location | Consequences |
| ClinVar | Open Targets | → | Variant evidence | OT integration |
| ClinicalTrials | PubMed | ↔ | Trial → Results | get_results |
| ClinicalTrials | Open Targets | → | Trial evidence | OT integration |
| PubMed | All | ← | Evidence hub | Literature |
| ClinPGx | ChEMBL | ↔ | Gene-drug | get_interactions |
| ClinPGx | UniProt | ↔ | Gene → Protein | get_gene_info |

---

## Example Workflows Across Multiple Platforms

### Workflow 1: Gene → All Connected Data

```
Start: TP53 (gene name)
  ↓ Ensembl.search_genes("TP53")
  → ENSG00000141510 (Ensembl ID)

  ↓ Parallel queries:
    • UniProt.search_by_gene("TP53") → P04637 (protein)
    • Open Targets.search_entities("TP53") → ENSG00000141510
    • ClinVar.search_variants_by_gene("TP53") → Variants
    • Reactome.find_pathways_by_gene("TP53") → Pathways

  ↓ From P04637:
    • UniProt.get_protein_interactions() → Protein partners
    • UniProt.get_protein_pathways() → Reactome pathways
    • ChEMBL.search_by_uniprot("P04637") → CHEMBL2093875 (target)

  ↓ From CHEMBL2093875:
    • ChEMBL.get_target_compounds() → All compounds binding TP53
    • Open Targets.get_target_known_drugs() → Approved drugs
    • ChEMBL.get_external_references() → Links to PubChem, etc.

  ↓ From ENSG00000141510:
    • Open Targets.get_target_associated_diseases() → TP53 diseases
    • Open Targets.get_target_literature_occurrences() → Publications

Result: Complete TP53 ecosystem with proteins, compounds, pathways, diseases, publications
```

---

### Workflow 2: Compound → All Targets & Diseases

```
Start: Aspirin (compound)
  ↓ ChEMBL.search_compounds("Aspirin")
  → CHEMBL25

  ↓ Get structure:
    • ChEMBL.get_compound_structure(CHEMBL25) → SMILES
    • PubChem.search_by_smiles(SMILES) → CID 2244

  ↓ Get targets:
    • ChEMBL.get_compound_targets(CHEMBL25) → [targets]
    • For each target:
      - Open Targets.get_target_associated_diseases() → Diseases
      - Open Targets.get_target_pathways() → Pathways
      - ClinicalTrials.search_by_intervention("Aspirin") → Trials

  ↓ Get bioactivity:
    • PubChem.get_compound_bioactivities(CID 2244) → Assays
    • ChEMBL.search_activities(molecule_id=CHEMBL25) → Activities

  ↓ Get pharmacogenomics:
    • ClinPGx.search_drugs("Aspirin") → Gene interactions

Result: All diseases aspirin can treat, mechanism, pharmacogenomics, and trials
```

---

### Workflow 3: Disease → Targets → Drugs → Trials

```
Start: "Alzheimer's Disease"
  ↓ Open Targets.search_entities("Alzheimer's")
  → EFO_0000249 (disease ID)

  ↓ Get associated targets:
    • Open Targets.get_disease_associated_targets(EFO_0000249)
    → [ENSG001, ENSG002, ...] with scores

  ↓ For each target:
    • Open Targets.get_target_known_drugs(ENSGxxx) → ChEMBL drugs
    • UniProt.search_by_gene(gene_symbol) → P04637
    • Reactome.find_pathways_by_gene(gene_symbol) → Pathways
    • ClinVar.search_variants_by_gene(gene_symbol) → Genetic variants

  ↓ For each drug:
    • ChEMBL.get_drug_info(ChEMBL_ID) → Development phase
    • ClinicalTrials.search_by_intervention(drug_name) → Trials
    • PubMed.search_pubmed("drug + Alzheimer") → Literature

  ↓ Get genetic evidence:
    • ClinVar → get disease-associated variants
    • Open Targets.get_target_disease_evidence() → All evidence

Result: Complete target-disease-drug-trial ecosystem with genetics
```

---

### Workflow 4: Variant → Gene → Protein → Compound → Drug

```
Start: rs1042522 (genetic variant)
  ↓ ClinVar.lookup_by_rsid("rs1042522")
  → TP53 p.Arg72Pro
  → Gene: TP53

  ↓ Ensembl.get_variant_consequences(rs1042522)
  → Consequence in TP53 (missense)
  → Structural impact

  ↓ UniProt.search_by_gene("TP53")
  → P04637 (protein)
  → Protein domains affected

  ↓ ChEMBL.search_by_uniprot(P04637)
  → CHEMBL2093875 (TP53 target)
  → Compounds binding TP53

  ↓ Open Targets.get_drug_linked_targets("TP53")
  → FDA-approved drugs targeting TP53-affected pathways

  ↓ ClinicalTrials.search_by_condition("TP53-related cancer")
  → Trials for this genotype

  ↓ ClinPGx.get_drug_gene_interactions("TP53", drug)
  → Personalized dosing implications

Result: Clinical interpretation with personalized drug recommendations
```

---

## Key Insights

### Strongest Hubs (most connections):
1. **Open Targets** - 24+ connections; integrates everything
2. **UniProt** - 9 connections; protein data hub
3. **Ensembl** - 8 connections; genomic foundation (ENSG IDs everywhere)
4. **ChEMBL** - 8 connections; compound-target hub

### Critical Bridges:
- **Gene symbol** ↔ UniProt ↔ Ensembl ↔ Open Targets (chain)
- **SMILES/InChI** ↔ ChEMBL ↔ PubChem (compound equivalence)
- **Genomic coordinates** ↔ rsID ↔ Gene (variant mapping)

### Missing Direct Links:
- PubChem CID ↔ ChEMBL ID (must go via SMILES/InChI)
- ClinVar variants ↔ ChEMBL compounds (no direct tool)
- UniProt ↔ Ensembl (must use gene symbol)

---

## ID Mapping Quick Reference

### Gene Symbol → Ensembl ID
| Starting With | Tool to Use | Example |
|--------------|-------------|---------|
| Gene symbol (BRCA1, TP53) | `Ensembl.search_genes(query="BRCA1")` | Returns ENSG00000012048 |
| Gene symbol | `Open Targets.search_entities(query="BRCA1", entity_type="target")` | Returns ENSG00000012048 |

**Important:** `Ensembl.lookup_gene()` only accepts Ensembl IDs, NOT gene symbols. Use `search_genes` for symbol-to-ID conversion.

### Ensembl ID → Gene Details
| Starting With | Tool to Use | Returns |
|--------------|-------------|---------|
| Ensembl ID (ENSG...) | `Ensembl.lookup_gene(gene_id="ENSG00000012048")` | Full gene details |
| Ensembl ID | `Open Targets.get_target_info(ensembl_id="ENSG00000012048")` | Target info with disease associations |

### Gene Symbol → UniProt Accession
| Starting With | Tool to Use | Example |
|--------------|-------------|---------|
| Gene symbol | `UniProt.search_by_gene(gene_name="TP53")` | Returns P04637 |
| Gene symbol | `UniProt.search_proteins(query="TP53", reviewed=true)` | Returns reviewed entries |

**Tip:** Always use `reviewed=true` to get Swiss-Prot (curated) entries instead of TrEMBL (unreviewed).

### UniProt → Ensembl (and vice versa)
| Direction | Tool to Use | Notes |
|-----------|-------------|-------|
| UniProt → Ensembl | `UniProt.get_external_references(accession="P04637")` | Look for Ensembl in xrefs |
| Ensembl → UniProt | `Ensembl.get_xrefs(id="ENSG00000141510")` | Look for Uniprot_gn entries |

### Variant IDs
| Starting With | Tool to Use | Returns |
|--------------|-------------|---------|
| rsID (rs121913343) | `ClinVar.lookup_by_rsid(rsid="rs121913343")` | Clinical significance |
| rsID | `Ensembl.get_variants(region="17:7673000-7674000")` | Variant details |
| Gene symbol | `ClinVar.search_variants_by_gene(gene_symbol="BRCA1")` | All variants in gene |

### Compound IDs
| Starting With | Tool to Use | Notes |
|--------------|-------------|-------|
| Drug name | `ChEMBL.search_compounds(query="imatinib")` | Returns CHEMBL941 |
| SMILES | `PubChem.search_by_smiles(smiles="...")` | Returns CID |
| ChEMBL ID | `ChEMBL.get_compound_info(chembl_id="CHEMBL941")` | Full compound data |

### Common Workflow Patterns

**Pattern 1: Gene Symbol → Full Analysis**
```
1. Ensembl.search_genes(query="BRCA1") → Get ENSG00000012048
2. Ensembl.lookup_gene(gene_id="ENSG00000012048") → Get gene details
3. UniProt.search_by_gene(gene_name="BRCA1") → Get P38398
4. Open Targets.get_target_info(ensembl_id="ENSG00000012048") → Get disease associations
```

**Pattern 2: Variant → Clinical Context**
```
1. ClinVar.lookup_by_rsid(rsid="rs80357906") → Get clinical significance
2. Ensembl.get_variant_consequences(id="rs80357906") → Get functional impact
3. ClinPGx.get_variant_annotations(variant="rs80357906") → Get PGx implications
```

---

## Summary Statistics

| **Metric** | **Count** |
|-----------|----------|
| Total Platforms | 10 |
| Total Tools Across All Platforms | 214 |
| Bidirectional Connections | 16 |
| Unidirectional Connections | 8 |
| Total Connection Paths | 40+ |
| Primary Hub Platforms | 4 (OT, UniProt, Ensembl, ChEMBL) |
| Distinct ID Systems | 12+ |
| Most Connected Platform | Open Targets (24+ connections) |
| Literature Hub | PubMed (35M+ articles) |

