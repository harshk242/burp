# Variant-to-Trial Mapping Report: BRCA1, TP53, and PALB2 in Breast Cancer

## Overview

This report maps specific ClinVar pathogenic variants in BRCA1, TP53, and PALB2 to potentially matching clinical trials. Clinical trials typically do not recruit based on individual ClinVar variant IDs; instead, they use broader eligibility criteria based on:

1. **Gene-level pathogenic mutations** (any pathogenic/likely pathogenic variant in the gene)
2. **Functional consequence type** (loss-of-function: frameshift, nonsense, splice site)
3. **Specific hotspot mutations** (e.g., TP53 R175H, Y220C)
4. **HRD status** (Homologous Recombination Deficiency)

---

## Variant Classification and Trial Eligibility Logic

| Mutation Type | Definition | Trial Eligibility Category |
|---------------|------------|---------------------------|
| Frameshift | Insertion/deletion causing reading frame shift | Loss-of-function (LOF) - eligible for BRCA/PALB2 trials |
| Nonsense | Premature stop codon (e.g., p.Lys503Ter) | Loss-of-function (LOF) - eligible for BRCA/PALB2 trials |
| Splice site | Disrupts mRNA splicing (e.g., c.97-1G>C) | Loss-of-function (LOF) - eligible for BRCA/PALB2 trials |
| Missense | Single amino acid change | Variable - depends on functional characterization |
| Hotspot | Recurrent mutation at specific position | Specific trials targeting that mutation |

---

## BRCA1 Variants and Matching Trials

### Variant Details

| ClinVar ID | Variant Name | Mutation Type | Protein Effect |
|------------|--------------|---------------|----------------|
| 4686574 | c.1103A>G | Missense | p.Glu368Gly |
| 4682075 | c.4978del | Frameshift | p.Glu1660fs |
| 4625641 | c.1507A>T | Nonsense | p.Lys503Ter |
| 4625631 | c.2954_2958delinsATA | Frameshift | p.Pro985fs |
| 4625605 | c.3761_3770del | Frameshift | p.Lys1254fs |
| 4625576 | c.3084dup | Nonsense | p.Asn1029Ter |
| 4625385 | c.2704G>T | Nonsense | p.Glu902Ter |
| 4539187 | c.3994G>T | Nonsense | p.Gly1332Ter |

### Trial Mapping for BRCA1 Variants

All **loss-of-function BRCA1 variants** (frameshift, nonsense, splice site) are eligible for trials requiring "pathogenic or likely pathogenic germline BRCA1 mutation."

| ClinVar ID | Variant | Type | Matching Trials |
|------------|---------|------|-----------------|
| **4682075** | c.4978del (p.Glu1660fs) | Frameshift (LOF) | NCT06380751, NCT04090567, NCT06201234, NCT04890613, NCT06177171 |
| **4625641** | c.1507A>T (p.Lys503Ter) | Nonsense (LOF) | NCT06380751, NCT04090567, NCT06201234, NCT04890613, NCT06177171 |
| **4625631** | c.2954_2958delinsATA (p.Pro985fs) | Frameshift (LOF) | NCT06380751, NCT04090567, NCT06201234, NCT04890613, NCT06177171 |
| **4625605** | c.3761_3770del (p.Lys1254fs) | Frameshift (LOF) | NCT06380751, NCT04090567, NCT06201234, NCT04890613, NCT06177171 |
| **4625576** | c.3084dup (p.Asn1029Ter) | Nonsense (LOF) | NCT06380751, NCT04090567, NCT06201234, NCT04890613, NCT06177171 |
| **4625385** | c.2704G>T (p.Glu902Ter) | Nonsense (LOF) | NCT06380751, NCT04090567, NCT06201234, NCT04890613, NCT06177171 |
| **4539187** | c.3994G>T (p.Gly1332Ter) | Nonsense (LOF) | NCT06380751, NCT04090567, NCT06201234, NCT04890613, NCT06177171 |
| **4686574** | c.1103A>G (p.Glu368Gly) | Missense | Requires functional assessment; may be eligible if classified as pathogenic |

### BRCA1 Trial Details

#### NCT06380751 - EvoPAR-Breast01 (Phase 3)
- **Intervention:** Saruparib (AZD5305) + Camizestrant vs CDK4/6i + Endocrine Therapy
- **Sponsor:** AstraZeneca
- **Eligibility:** "Documented germline tumour loss of function mutation in BRCA1, BRCA2, or PALB2"
- **Eligible Variants:** All BRCA1 LOF variants (4682075, 4625641, 4625631, 4625605, 4625576, 4625385, 4539187)
- **Disease:** HR+/HER2- Advanced Breast Cancer
- **Status:** Recruiting

#### NCT04090567 - Olaparib + Cediranib/AZD6738 (Phase 2)
- **Intervention:** Olaparib with Cediranib or Ceralasertib (AZD6738)
- **Sponsor:** MD Anderson Cancer Center
- **Eligibility:** "Women with advanced/metastatic HER2 negative, BRCA germline positive breast cancer"
- **Eligible Variants:** All BRCA1 pathogenic variants
- **Disease:** Advanced/Metastatic Breast Cancer
- **Status:** Recruiting

#### NCT06201234 - Elacestrant + Olaparib (Phase 2)
- **Intervention:** Elacestrant (oral SERD) + Olaparib
- **Sponsor:** GBG Forschungs GmbH
- **Eligibility:** "Patients with deleterious or suspected deleterious gBRCA1/2 mutation"
- **Eligible Variants:** All BRCA1 pathogenic variants
- **Disease:** HR+/HER2- Locally Advanced or Metastatic Breast Cancer
- **Status:** Recruiting

#### NCT04890613 - CX-5461 Study (Phase 1)
- **Intervention:** CX-5461 (G-quadruplex stabilizer)
- **Sponsor:** Senhwa Biosciences
- **Eligibility:** "Documented evidence of pathogenic or likely pathogenic somatic or germline mutation in BRCA1/2 and/or PALB2, and/or HRD-associated mutations"
- **Eligible Variants:** All BRCA1 LOF variants; also accepts ATM, CHEK2, RAD51C, and other HRD genes
- **Disease:** Solid Tumors (pancreas, prostate, breast, ovary)
- **Status:** Recruiting

#### NCT06177171 - Olaparib + ASTX727 (Phase 1)
- **Intervention:** Olaparib + ASTX727 (decitabine/cedazuridine)
- **Sponsor:** UCSF
- **Eligibility:** "BRCA1/2- and Homologous Recombination Deficient (HRD)-Mutated Tumors"
- **Eligible Variants:** All BRCA1 pathogenic variants
- **Disease:** BRCA/HRD-Mutated Tumors
- **Status:** Recruiting

---

## TP53 Variants and Matching Trials

### Variant Details

| ClinVar ID | Variant Name | Mutation Type | Protein Effect |
|------------|--------------|---------------|----------------|
| 4686570 | c.1168_1171dup | Frameshift | p.Asp391delinsAlaTer |
| 4685939 | c.838A>T | Nonsense | p.Arg280Ter |
| 4553149 | c.153_159dup | Frameshift | p.Phe54fs |
| 4553134 | c.142_151del | Frameshift | p.Asp48fs |
| 4553048 | c.265_272del | Frameshift | p.Pro89fs |
| 4553010 | c.503del | Frameshift | p.His168fs |
| 4427951 | c.97-1G>C | Splice site | Splice acceptor variant |

### Trial Mapping for TP53 Variants

TP53 trials are more selective - many target **specific hotspot mutations** (R175H, Y220C). General TP53 LOF variants qualify for Li-Fraumeni syndrome studies.

| ClinVar ID | Variant | Type | Matching Trials |
|------------|---------|------|-----------------|
| **4686570** | c.1168_1171dup (p.Asp391delinsAlaTer) | Frameshift (LOF) | NCT01443468 (Li-Fraumeni study) |
| **4685939** | c.838A>T (p.Arg280Ter) | Nonsense (LOF) | NCT01443468 (Li-Fraumeni study) |
| **4553149** | c.153_159dup (p.Phe54fs) | Frameshift (LOF) | NCT01443468 (Li-Fraumeni study) |
| **4553134** | c.142_151del (p.Asp48fs) | Frameshift (LOF) | NCT01443468 (Li-Fraumeni study) |
| **4553048** | c.265_272del (p.Pro89fs) | Frameshift (LOF) | NCT01443468 (Li-Fraumeni study) |
| **4553010** | c.503del (p.His168fs) | Frameshift (LOF) | NCT01443468 (Li-Fraumeni study) |
| **4427951** | c.97-1G>C (splice site) | Splice (LOF) | NCT01443468 (Li-Fraumeni study) |

### TP53 Hotspot-Specific Trials (Require Specific Mutations)

These trials are **NOT eligible** for the variants listed above - they require specific hotspot mutations:

| Trial | Required Mutation | Eligible? |
|-------|-------------------|-----------|
| NCT04585750 (PYNNACLE) | TP53 Y220C only | No - requires codon 220 mutation |
| NCT05877599 (NT-175) | TP53 R175H only + HLA-A*02:01 | No - requires codon 175 mutation |
| NCT06778863 (GUARDIAN-101) | TP53 R175H only + HLA-A*02:01 | No - requires codon 175 mutation |

### TP53 Trial Details

#### NCT01443468 - Li-Fraumeni Syndrome Study (Observational)
- **Type:** Natural history/screening study
- **Sponsor:** National Cancer Institute (NCI)
- **Eligibility:** "A personal history of a germline TP53 mutation" OR "A family or personal medical history of neoplasia consistent with the diagnosis of LFS or LFL"
- **Eligible Variants:** ALL TP53 pathogenic variants (4686570, 4685939, 4553149, 4553134, 4553048, 4553010, 4427951)
- **Status:** Recruiting
- **Note:** Observational study for cancer screening and genetic studies

#### NCT04585750 - PYNNACLE Study (Phase 1/2)
- **Intervention:** Rezatapopt (PC14586) - p53 Y220C reactivator
- **Sponsor:** PMV Pharmaceuticals
- **Required Mutation:** "TP53 Y220C mutation" specifically
- **Eligible Variants:** NONE of the listed variants (requires Y220C hotspot)
- **Mechanism:** Restores wild-type p53 conformation specifically for Y220C mutant
- **Status:** Recruiting

#### NCT05877599 - NT-175 Study (Phase 1)
- **Intervention:** NT-175 (T-cell therapy)
- **Sponsor:** AstraZeneca
- **Required Mutation:** "TP53 R175H variant mutation" AND "HLA-A*02:01 positive"
- **Eligible Variants:** NONE of the listed variants (requires R175H hotspot)
- **Mechanism:** Engineered T-cells targeting R175H neoantigen
- **Status:** Recruiting

#### NCT06778863 - GUARDIAN-101 (Phase 1)
- **Intervention:** CLSP-1025 (bispecific antibody)
- **Sponsor:** Clasp Therapeutics
- **Required Mutation:** "TP53 R175H variant mutation" AND "HLA-A*02:01 positive"
- **Eligible Variants:** NONE of the listed variants (requires R175H hotspot)
- **Exclusion:** "Patients with Li-Fraumeni syndrome or other known germline p53 R175H mutation"
- **Status:** Recruiting

---

## PALB2 Variants and Matching Trials

### Variant Details

| ClinVar ID | Variant Name | Mutation Type | Protein Effect |
|------------|--------------|---------------|----------------|
| 4686110 | c.622G>T | Missense | p.Asp208Tyr |
| 4663899 | c.585_591del | Frameshift | p.Arg196fs |
| 4663611 | c.3136dup | Frameshift | p.Leu1046fs |
| 4536096 | c.3247_3250del | Frameshift | p.Glu1083fs |
| 4533157 | c.2899A>T | Nonsense | p.Lys967Ter |
| 4533155 | c.1684+1G>C | Splice site | Splice donor variant |
| 4294293 | c.355C>T | Nonsense | p.Gln119Ter |

### Trial Mapping for PALB2 Variants

| ClinVar ID | Variant | Type | Matching Trials |
|------------|---------|------|-----------------|
| **4663899** | c.585_591del (p.Arg196fs) | Frameshift (LOF) | NCT06380751, NCT04890613, NCT06403904 |
| **4663611** | c.3136dup (p.Leu1046fs) | Frameshift (LOF) | NCT06380751, NCT04890613, NCT06403904 |
| **4536096** | c.3247_3250del (p.Glu1083fs) | Frameshift (LOF) | NCT06380751, NCT04890613, NCT06403904 |
| **4533157** | c.2899A>T (p.Lys967Ter) | Nonsense (LOF) | NCT06380751, NCT04890613, NCT06403904 |
| **4533155** | c.1684+1G>C (splice site) | Splice (LOF) | NCT06380751, NCT04890613, NCT06403904 |
| **4294293** | c.355C>T (p.Gln119Ter) | Nonsense (LOF) | NCT06380751, NCT04890613, NCT06403904 |
| **4686110** | c.622G>T (p.Asp208Tyr) | Missense | Requires functional assessment |

### PALB2 Trial Details

#### NCT06380751 - EvoPAR-Breast01 (Phase 3)
- **Intervention:** Saruparib (AZD5305) + Camizestrant
- **Sponsor:** AstraZeneca
- **Eligibility:** "Documented germline tumour loss of function mutation in BRCA1, BRCA2, or PALB2"
- **Eligible Variants:** All PALB2 LOF variants (4663899, 4663611, 4536096, 4533157, 4533155, 4294293)
- **Disease:** HR+/HER2- Advanced Breast Cancer
- **Status:** Recruiting

#### NCT04890613 - CX-5461 Study (Phase 1)
- **Intervention:** CX-5461
- **Sponsor:** Senhwa Biosciences
- **Eligibility:** "Documented evidence of pathogenic or likely pathogenic somatic or germline mutation in BRCA1/2 and/or PALB2"
- **Eligible Variants:** All PALB2 LOF variants
- **Disease:** Solid Tumors
- **Status:** Recruiting

#### NCT06403904 - Palbreast Study (Observational)
- **Type:** Natural history study
- **Sponsor:** Modena University Hospital
- **Eligibility:** "Has documented mutation in PALB2 gene (germline or somatic) that is predicted to be deleterious or suspected deleterious"
- **Exclusion:** "Has a benign variant of PALB2 gene or variant of uncertain significance (VUS)"
- **Eligible Variants:** All PALB2 pathogenic variants
- **Status:** Recruiting

---

## Summary: Variant-to-Trial Matrix

### BRCA1 Variants

| ClinVar ID | Variant | NCT06380751 | NCT04090567 | NCT06201234 | NCT04890613 | NCT06177171 |
|------------|---------|-------------|-------------|-------------|-------------|-------------|
| 4682075 | p.Glu1660fs | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4625641 | p.Lys503Ter | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4625631 | p.Pro985fs | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4625605 | p.Lys1254fs | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4625576 | p.Asn1029Ter | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4625385 | p.Glu902Ter | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4539187 | p.Gly1332Ter | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4686574 | p.Glu368Gly | ? | ? | ? | ? | ? |

### TP53 Variants

| ClinVar ID | Variant | NCT01443468 | NCT04585750 | NCT05877599 | NCT06778863 |
|------------|---------|-------------|-------------|-------------|-------------|
| 4686570 | p.Asp391delinsAlaTer | ✓ | ✗ | ✗ | ✗ |
| 4685939 | p.Arg280Ter | ✓ | ✗ | ✗ | ✗ |
| 4553149 | p.Phe54fs | ✓ | ✗ | ✗ | ✗ |
| 4553134 | p.Asp48fs | ✓ | ✗ | ✗ | ✗ |
| 4553048 | p.Pro89fs | ✓ | ✗ | ✗ | ✗ |
| 4553010 | p.His168fs | ✓ | ✗ | ✗ | ✗ |
| 4427951 | c.97-1G>C | ✓ | ✗ | ✗ | ✗ |

Legend: ✓ = Eligible, ✗ = Not Eligible (requires specific hotspot), ? = Requires functional assessment

### PALB2 Variants

| ClinVar ID | Variant | NCT06380751 | NCT04890613 | NCT06403904 |
|------------|---------|-------------|-------------|-------------|
| 4663899 | p.Arg196fs | ✓ | ✓ | ✓ |
| 4663611 | p.Leu1046fs | ✓ | ✓ | ✓ |
| 4536096 | p.Glu1083fs | ✓ | ✓ | ✓ |
| 4533157 | p.Lys967Ter | ✓ | ✓ | ✓ |
| 4533155 | c.1684+1G>C | ✓ | ✓ | ✓ |
| 4294293 | p.Gln119Ter | ✓ | ✓ | ✓ |
| 4686110 | p.Asp208Tyr | ? | ? | ? |

---

## Key Findings

### 1. BRCA1 Loss-of-Function Variants
- **7 of 8 variants** are clear loss-of-function (frameshift/nonsense) and eligible for **5 recruiting trials**
- PARP inhibitor trials (olaparib, saruparib) accept any pathogenic BRCA1 mutation
- The missense variant (p.Glu368Gly) requires functional classification confirmation

### 2. TP53 Variants
- **All 7 variants** are loss-of-function but only qualify for the **Li-Fraumeni observational study**
- **No therapeutic interventional trials** match these variants - hotspot-specific trials require R175H or Y220C mutations
- This represents a significant gap for patients with non-hotspot TP53 mutations

### 3. PALB2 Loss-of-Function Variants
- **6 of 7 variants** are clear loss-of-function and eligible for **3 recruiting trials**
- PALB2 is now accepted alongside BRCA1/2 in most HRD-targeted trials
- The missense variant (p.Asp208Tyr) requires functional classification confirmation

---

## Limitations and Caveats

1. **Eligibility verification required:** Trial eligibility must be confirmed by the treating physician and study coordinators based on full eligibility criteria
2. **Variant classification:** Missense variants require expert review of ClinVar submissions and functional data
3. **Additional criteria:** Trials have additional requirements (performance status, organ function, prior therapies) not captured here
4. **Geographic availability:** Trial sites are limited; patient location may restrict access
5. **Dynamic enrollment:** Trial status changes; verify current enrollment status at ClinicalTrials.gov

---

## Platform Citations

1. **ClinVar:** https://www.ncbi.nlm.nih.gov/clinvar/
2. **ClinicalTrials.gov:** https://clinicaltrials.gov
3. **Ensembl:** https://www.ensembl.org

---

*Report generated: 2026-01-28*
