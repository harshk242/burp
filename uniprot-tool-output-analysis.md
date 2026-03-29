# UniProt Tool Output Analysis for Noise Reduction Design

**Date**: 2026-03-29
**Test protein**: BRCA1 (P38398) — a well-annotated, large entry (1863 aa, annotation score 5)
**Search size**: 2 results per search tool

---

## 1. Tool Output Sizes Summary

### Tools that overflow (saved to file, too large for LLM context)

| Tool | Output (chars) | Notes |
|---|---|---|
| `batch_protein_lookup` | **1,123,052** | 2 entries, full raw data each |
| `advanced_search` | **797,803** | 2 results, full raw entries |
| `get_protein_info` | **537,825** | Single entry, full raw |
| `get_protein_sequence` (json) | **537,825** | **BUG: identical to get_protein_info** |
| `get_protein_homologs` | **491,821** | 2 results, full raw entries |
| `get_protein_features` | **290,781** | Single entry, features+comments+keywords |
| `get_protein_orthologs` | **272,797** | 2 results, full raw entries |
| `search_by_localization` | **270,856** | 2 results, full raw entries |
| `search_by_function` | **230,726** | 2 results, full raw entries |
| `get_external_references` | **187,441** | Single entry, all xrefs |
| `get_protein_variants` | **165,909** | Single entry, all variants |
| `search_proteins` | **139,413** | 2 results, full raw entries |
| `get_literature_references` | **125,953** | Single entry, 109 references |
| `search_by_taxonomy` | **116,319** | 2 results, full raw entries |
| `export_protein_data` (gff) | **65,979** | GFF text format |

### Tools that returned inline (fit in context)

| Tool | Output (chars) | Notes |
|---|---|---|
| `get_protein_structure` | ~15,000 | Extracted: PDB refs + structural features + subunit |
| `get_annotation_confidence` | ~12,000 | Mostly redundant evidence codes |
| `get_protein_interactions` | ~12,000 | Extracted: interactions + subunit comments |
| `search_by_gene` | ~8,500 | **Has custom extractor** - LLM-optimized format |
| `get_protein_pathways` | ~8,000 | Extracted: KEGG + Reactome + pathway comments |
| `get_protein_domains_detailed` | ~5,000 | Extracted: domains + regions + InterPro/Pfam/SMART |
| `analyze_sequence_composition` | ~1,500 | Computed: aa composition, hydrophobicity |
| `get_phylogenetic_info` | ~500 | Small: lineage |
| `get_taxonomy_info` | ~500 | Small: organism + lineage |
| `compare_proteins` | ~300 | Computed: side-by-side summary |
| `validate_accession` | ~200 | Simple check |

---

## 2. Raw UniProt Entry Structure (get_protein_info / search results)

All search tools (`search_proteins`, `search_by_function`, `search_by_taxonomy`, `search_by_localization`, `advanced_search`, `get_protein_homologs`, `get_protein_orthologs`) and `batch_protein_lookup` return **full raw UniProt entries** with this structure:

```
{results: [{...entry}, {...entry}]}       // search tools
{batchResults: [{accession, data: {...entry}}]}  // batch lookup
{...entry}                                 // single-entry tools (get_protein_info, get_protein_sequence)
```

### Entry top-level keys and sizes (BRCA1 P38398, 278K chars parsed)

| Field | Chars | % | Count/Size | Noise Level |
|---|---|---|---|---|
| `features` | **112,872** | **40%** | 313 features | HIGH - dominated by Natural variants (74K) |
| `references` | **70,715** | **25%** | 109 references | HIGH - full author lists, citations |
| `uniProtKBCrossReferences` | **55,216** | **20%** | 374 xrefs across 93 databases | MEDIUM - many low-value DBs |
| `comments` | **33,199** | **12%** | 30 comments (17 types) | LOW-MEDIUM - mostly useful |
| `keywords` | 2,362 | 1% | 34 keywords | LOW |
| `sequence` | 1,976 | 1% | 1863 aa + metadata | MEDIUM - raw aa string |
| `proteinDescription` | 707 | <1% | names, EC numbers | LOW |
| `extraAttributes` | 597 | <1% | count summaries | LOW |
| `organism` | 251 | <1% | name, taxon, lineage | LOW |
| `entryAudit` | 149 | <1% | dates, versions | LOW - rarely needed |
| Other scalars | ~150 | <1% | accession, id, type | NONE |

### Features breakdown (112K chars, 313 features)

| Feature Type | Count | Total Chars | Avg/item | Noise Level |
|---|---|---|---|---|
| **Natural variant** | **170** | **74,570** | 438 | HIGH - massive, has evidences per variant |
| Mutagenesis | 27 | 9,707 | 359 | MEDIUM |
| Modified residue | 30 | 7,682 | 256 | MEDIUM |
| Cross-link | 13 | 4,006 | 308 | MEDIUM |
| Beta strand | 19 | 3,898 | 205 | HIGH - secondary structure, rarely queried |
| Helix | 15 | 2,987 | 199 | HIGH - secondary structure, rarely queried |
| Alternative sequence | 8 | 2,500 | 312 | LOW |
| Sequence conflict | 8 | 2,201 | 275 | HIGH - artifact, almost never queried |
| Region | 9 | 1,966 | 218 | LOW |
| Compositional bias | 5 | 1,186 | 237 | MEDIUM |
| Turn | 5 | 985 | 197 | HIGH - secondary structure |
| Domain | 2 | 446 | 223 | LOW |
| Zinc finger | 1 | 227 | 227 | LOW |
| Chain | 1 | 197 | 197 | LOW |

### Comments breakdown (33K chars, 30 comments)

| Comment Type | Count | Chars | Noise Level |
|---|---|---|---|
| INTERACTION | 1 | 10,346 | LOW (useful) but has redundant `interactantOne` |
| DISEASE | 5 | 6,377 | LOW |
| SUBUNIT | 1 | 5,922 | LOW |
| FUNCTION | 1 | 2,653 | LOW |
| SUBCELLULAR LOCATION | 3 | 1,668 | LOW |
| PTM | 2 | 1,287 | LOW |
| ALTERNATIVE PRODUCTS | 1 | 1,167 | MEDIUM |
| CATALYTIC ACTIVITY | 1 | 668 | LOW |
| MISCELLANEOUS | 3 | 584 | MEDIUM |
| SEQUENCE CAUTION | 3 | 538 | HIGH - rarely queried |
| DOMAIN | 2 | 479 | LOW |
| CAUTION | 1 | 386 | MEDIUM |
| WEB RESOURCE | 2 | 329 | MEDIUM |
| ACTIVITY REGULATION | 1 | 268 | LOW |
| POLYMORPHISM | 1 | 221 | LOW |
| TISSUE SPECIFICITY | 1 | 183 | LOW |
| PATHWAY | 1 | 92 | LOW |

### Cross-references breakdown (55K chars, 374 xrefs)

Top databases by size:

| Database | Count | Chars | Avg | Query Relevance |
|---|---|---|---|---|
| GO | 77 | 19,006 | 246 | HIGH |
| PDB | 32 | 4,985 | 155 | HIGH |
| RefSeq | 33 | 4,491 | 136 | MEDIUM |
| Reactome | 27 | 3,899 | 144 | HIGH |
| EMBL | 16 | 2,625 | 164 | LOW |
| PDBsum | 32 | 2,624 | 82 | LOW (redundant with PDB) |
| Ensembl | 13 | 2,327 | 179 | MEDIUM |
| Orphanet | 9 | 984 | 109 | MEDIUM |
| InterPro | 9 | 885 | 98 | HIGH |
| ProteomicsDB | 7 | 761 | 108 | LOW |
| *60+ other databases* | ~80 | ~13K | varies | LOW |

### Pervasive noise pattern: `.evidences` arrays

Evidence arrays appear at every level — in comments, features, xrefs, proteinDescription. Each looks like:
```json
{
  "evidenceCode": "ECO:0000269",
  "source": "PubMed",
  "id": "23867111"
}
```

**Total contribution**: 44,554 chars (16% of entry) — purely provenance metadata, almost never needed by end users.

---

## 3. Noise Reduction Impact Measurements

### Single entry (get_protein_info, BRCA1 P38398)

| What's removed | Chars saved | % of total |
|---|---|---|
| `evidences` arrays (everywhere) | 44,554 | 16% |
| `references` array | 70,729 | 25% |
| `Natural variant` features | 74,740 | 27% |
| Secondary structure features (Helix/Beta strand/Turn) | 7,909 | 3% |
| `sequence.value` (raw amino acid string) | 1,874 | 1% |

### Combined noise reduction strategies

| Strategy | Result (chars) | Reduction |
|---|---|---|
| **Original** | **278,533** | — |
| Remove evidences + sequence + references + secondary structure + seq conflicts | 154,426 | **44%** |
| Above + filter xrefs to high-value DBs only | ~131,452 | **53%** |
| Above + remove interactantOne + more metadata | ~127,448 | **54%** |

### Search results (2 entries per search)

| Tool | Original | After Noise Reduction | Reduction |
|---|---|---|---|
| `search_proteins` | 62,203 | 27,450 | **56%** |
| `search_by_function` | 101,536 | 28,024 | **72%** |

---

## 4. Identified Noise Categories for Tier 1 jq Filters

### Category A: Universal noise (all UniProt tools returning raw data)

1. **`evidences` arrays** (16% savings) — provenance metadata, never queried by users
   ```jq
   walk(if type == "object" then del(.evidences) else . end)
   ```

2. **`sequence.value`** (raw amino acid string) — enormous for large proteins, only needed if user asks specifically
   ```jq
   if .results then .results |= map(del(.sequence.value)) else del(.sequence.value) end
   ```

3. **Null values** — clutter
   ```jq
   del(.. | nulls)
   ```

### Category B: Per-entry-field noise (tools returning full entries)

4. **`references`** (25% savings) — full citation data with author lists, almost never needed
   ```jq
   if .results then .results |= map(del(.references)) else del(.references) end
   ```

5. **Secondary structure features** (Helix, Beta strand, Turn) — 3%, rarely queried
   ```jq
   .features |= map(select(.type != "Helix" and .type != "Beta strand" and .type != "Turn"))
   ```
   Or applied to search results:
   ```jq
   if .results then .results |= map(.features |= map(select(.type != "Helix" and .type != "Beta strand" and .type != "Turn"))) else .features |= map(select(.type != "Helix" and .type != "Beta strand" and .type != "Turn")) end
   ```

6. **Sequence conflict features** — artifact of sequencing, never queried
   ```jq
   .features |= map(select(.type != "Sequence conflict"))
   ```

7. **Low-value metadata fields**:
   ```jq
   del(.entryAudit) | del(.secondaryAccessions) | del(.extraAttributes) | del(.proteinExistence)
   ```

### Category C: Selective reduction (configurable)

8. **Low-value xref databases** — keep only commonly queried ones
   ```jq
   .uniProtKBCrossReferences |= map(select(
     .database == "PDB" or .database == "GO" or .database == "Reactome" or
     .database == "KEGG" or .database == "Ensembl" or .database == "InterPro" or
     .database == "Pfam" or .database == "SMART" or .database == "Orphanet" or
     .database == "MIM" or .database == "ChEMBL" or .database == "OpenTargets" or
     .database == "HGNC" or .database == "ComplexPortal" or .database == "STRING"
   ))
   ```

9. **Redundant interaction fields** — `interactantOne` always repeats the queried protein
   ```jq
   .comments |= map(if .commentType == "INTERACTION" then .interactions |= map(del(.interactantOne)) else . end)
   ```

10. **Result capping** for search tools (safety net, already in plan)
    ```jq
    if .results then .results |= .[:10] else . end
    ```

### Category D: Should NOT be removed in Tier 1 (query-dependent)

These contain high-value data that varies by question:
- **Natural variant features** (74K, 27%) — huge, but critical for "What mutations affect BRCA1?"
- **INTERACTION comments** — critical for "What interacts with BRCA1?"
- **DISEASE comments** — critical for "What diseases are linked to BRCA1?"
- **GO xrefs** — critical for "What functions does BRCA1 have?"
- **PDB xrefs** — critical for "What structures exist for BRCA1?"

These should be handled by **Tier 2** (LLM writes a jq filter to extract just what's needed).

---

## 5. Bugs & Issues Found

1. **`get_protein_sequence` (json format) returns identical data to `get_protein_info`** — 537K chars when the user just wants the sequence. Should return only `{accession, sequence: {value, length, molWeight}}`.

2. **`search_by_gene` is the ONLY tool with custom extraction** — returns ~8.5K chars vs 278K+ raw. All other search/get tools return raw. This validates the plan to build a universal noise reduction layer.

3. **All search tools return full entries** — `search_proteins`, `search_by_function`, `search_by_taxonomy`, `search_by_localization`, `advanced_search`, `get_protein_homologs`, `get_protein_orthologs` all return `{results: [...full entries...]}` with every field.

4. **`batch_protein_lookup` is the largest** at 1.1MB for just 2 proteins — it wraps full entries in `{batchResults: [{accession, data: {...full entry}}]}`.

---

## 6. Recommended Tier 1 jq Noise Reduction Config

```yaml
noise_reduction:
  uniprot:
    # Universal: remove provenance metadata (16% savings)
    - "walk(if type == \"object\" then del(.evidences) else . end)"

    # Remove raw amino acid sequences (proportional to protein length)
    - "if .results then .results |= map(del(.sequence.value)) elif .batchResults then .batchResults |= map(.data |= del(.sequence.value)) else del(.sequence.value) end"

    # Remove full reference/citation arrays (25% savings)
    - "if .results then .results |= map(del(.references)) elif .batchResults then .batchResults |= map(.data |= del(.references)) else del(.references) end"

    # Remove secondary structure features (Helix, Beta strand, Turn, Sequence conflict, Compositional bias)
    - "walk(if type == \"object\" and has(\"features\") and (.features | type) == \"array\" then .features |= map(select(.type != \"Helix\" and .type != \"Beta strand\" and .type != \"Turn\" and .type != \"Sequence conflict\" and .type != \"Compositional bias\")) else . end)"

    # Remove low-value metadata
    - "walk(if type == \"object\" then del(.entryAudit, .secondaryAccessions, .extraAttributes, .proteinExistence) else . end)"

    # Remove redundant interactantOne from INTERACTION comments
    - "walk(if type == \"object\" and .commentType == \"INTERACTION\" then .interactions |= map(del(.interactantOne)) else . end)"

    # Filter xrefs to high-value databases only
    - "walk(if type == \"object\" and has(\"uniProtKBCrossReferences\") and (.uniProtKBCrossReferences | type) == \"array\" then .uniProtKBCrossReferences |= map(select(.database == \"PDB\" or .database == \"GO\" or .database == \"Reactome\" or .database == \"KEGG\" or .database == \"Ensembl\" or .database == \"InterPro\" or .database == \"Pfam\" or .database == \"SMART\" or .database == \"Orphanet\" or .database == \"MIM\" or .database == \"ChEMBL\" or .database == \"OpenTargets\" or .database == \"HGNC\" or .database == \"ComplexPortal\" or .database == \"STRING\" or .database == \"RefSeq\")) else . end)"

    # Cap search results at 10 entries
    - "if .results then .results |= .[:10] elif .batchResults then .batchResults |= .[:10] else . end"

    # Remove nulls
    - "del(.. | nulls)"
```

### Expected impact: ~55-72% reduction

| Scenario | Before | After | Reduction |
|---|---|---|---|
| Single protein info (BRCA1) | 278K | ~127K | 54% |
| search_proteins (2 results) | 62K | ~27K | 56% |
| search_by_function (2 results) | 101K | ~28K | 72% |
| batch_protein_lookup (2 proteins) | ~500K | ~200K | ~60% |

After Tier 1, large entries like BRCA1 (~127K remaining) will still need Tier 2 (artifact store + inspect_artifact) for queries that don't need the full entry.

---

## 7. Tool-Specific Observations

### Tools that already have good extraction (no Tier 1 needed if small enough)

- `search_by_gene` — Custom extractor, ~8.5K output. Already optimized.
- `get_protein_interactions` — Returns structured interaction list. Manageable.
- `get_protein_structure` — Returns PDB refs + structural features. Manageable.
- `get_protein_pathways` — Returns KEGG + Reactome + function. Manageable.
- `get_protein_domains_detailed` — Returns domains + InterPro/Pfam. Manageable.
- `analyze_sequence_composition` — Computed data. Small.
- `get_phylogenetic_info` / `get_taxonomy_info` — Small.
- `validate_accession` / `compare_proteins` — Tiny.

### Tools that will benefit most from Tier 1

1. `batch_protein_lookup` — **1.1MB** for 2 proteins. Each entry is a full raw entry.
2. `advanced_search` — **797K** for 2 results.
3. `get_protein_info` — **537K** single entry.
4. `get_protein_sequence` (json) — **537K** (BUG: returns full entry).
5. `get_protein_homologs` — **491K** for 2 results.
6. `get_protein_features` — **290K** single entry.
7. All other search tools — 100-270K for just 2 results.

### Tools where Tier 2 (artifact inspection) will be critical

After Tier 1 noise reduction (~55% reduction), these will still likely exceed the artifact threshold:
- `get_protein_info` for well-annotated proteins (BRCA1: ~127K remaining)
- `get_protein_features` for variant-rich proteins
- Search results with 5+ entries
- `batch_protein_lookup` with 3+ proteins
- `get_external_references` for well-annotated proteins

---

## 8. Data Samples for Reference

### Sample: evidences array (appears everywhere)
```json
{
  "evidences": [
    {"evidenceCode": "ECO:0000269", "source": "PubMed", "id": "23867111"},
    {"evidenceCode": "ECO:0000269", "source": "PubMed", "id": "14722926"}
  ]
}
```

### Sample: Natural variant feature (170 in BRCA1, 74K chars total)
```json
{
  "type": "Natural variant",
  "location": {"start": {"value": 4, "modifier": "EXACT"}, "end": {"value": 4, "modifier": "EXACT"}},
  "description": "in BC; uncertain significance; dbSNP:rs786203152",
  "featureCrossReferences": [{"database": "dbSNP", "id": "rs786203152"}],
  "evidences": [{"evidenceCode": "ECO:0000269", "source": "PubMed", "id": "23867111"}],
  "featureId": "VAR_070458",
  "alternativeSequence": {"originalSequence": "E", "alternativeSequences": ["K"]}
}
```

### Sample: Reference (109 in BRCA1, 70K chars total)
```json
{
  "referenceNumber": 1,
  "citation": {
    "id": "7545954",
    "citationType": "journal article",
    "authors": ["Miki Y.", "Swensen J.", "...(45 authors)..."],
    "citationCrossReferences": [{"database": "PubMed", "id": "7545954"}, {"database": "DOI", "id": "10.1126/science.7545954"}],
    "title": "A strong candidate for the breast and ovarian cancer susceptibility gene BRCA1.",
    "publicationDate": "1994",
    "journal": "Science",
    "firstPage": "66", "lastPage": "71", "volume": "266"
  },
  "referencePositions": ["NUCLEOTIDE SEQUENCE [MRNA] (ISOFORM 1)", "VARIANT BC ARG-1775"]
}
```

### Sample: Cross-reference (374 in BRCA1, 55K chars total)
```json
{"database": "GO", "id": "GO:0070531", "properties": [{"key": "GoTerm", "value": "C:BRCA1-A complex"}, {"key": "GoEvidenceType", "value": "IDA:UniProtKB"}], "evidences": [...]}
{"database": "EMBL", "id": "U14680", "properties": [{"key": "ProteinId", "value": "AAA73985.1"}, {"key": "Status", "value": "-"}, {"key": "MoleculeType", "value": "mRNA"}]}
{"database": "PDB", "id": "1JM7", "properties": [{"key": "Method", "value": "NMR"}, {"key": "Resolution", "value": "-"}, {"key": "Chains", "value": "A=1-110"}]}
```

### Sample: INTERACTION comment (48 interactions in BRCA1)
```json
{
  "interactantOne": {"uniProtKBAccession": "P38398", "intActId": "EBI-349905"},
  "interactantTwo": {"uniProtKBAccession": "Q6UWZ7", "geneName": "ABRAXAS1", "intActId": "EBI-1263451"},
  "numberOfExperiments": 16,
  "organismDiffer": false
}
```

### Sample: search_by_gene output (custom extractor, for comparison)
```json
{
  "gene_query": "BRCA1",
  "species_filter": ["human"],
  "total_results_returned": 2,
  "entries": [{
    "accession": "P38398",
    "id": "BRCA1_HUMAN",
    "name": "Breast cancer type 1 susceptibility protein",
    "gene": "BRCA1",
    "gene_synonyms": ["RNF53"],
    "organism": "Homo sapiens",
    "taxon_id": 9606,
    "annotation_score": 5,
    "sequence_length": 1863,
    "mol_weight": 207721,
    "function": "E3 ubiquitin-protein ligase that...(truncated)",
    "subunit": "Heterodimer with BARD1...(truncated)",
    "pathway": "Protein modification; protein ubiquitination",
    "tissue_specificity": "...",
    "catalytic_activity": "...",
    "ptm": ["...", "..."],
    "diseases": [{name, description, note}, ...],
    "subcellular_locations": ["Nucleus", "Chromosome", "Cytoplasm"],
    "interactions": [{gene, n_experiments}, ...] (top 20),
    "domains": [{type, name, start, end}, ...],
    "natural_variants": {total_count: 170, pathogenic: [...]},
    "keywords": [...],
    "xrefs": {hgnc, omim, ensembl_gene, chembl, open_targets, clinpgx, reactome_pathways, go_terms, orphanet, interpro}
  }]
}
```
This is the **gold standard** — 8.5K chars vs 278K raw. The jq noise reduction won't achieve this level (it's ~127K after aggressive strip), but Tier 2 inspection can.
