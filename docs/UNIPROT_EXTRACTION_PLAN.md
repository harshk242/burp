# UniProt Data Extraction Plan

Covers how to call `search_by_gene`, filter the response down to relevant entries,
and extract only the semantically useful fields — eliminating ~97–98% of token bloat.

---

## 1. Species Selection (Tool Call Level)

### Default Behavior
When the user does not specify species, pass `taxon_id=9606` (Homo sapiens) to `search_by_gene`.
UniProt returns up to 25 entries across all species by default — this must be constrained at call time.

### Configurable Behavior
When the user specifies one or more species, translate them to NCBI Taxonomy IDs and pass the list.
The tool should accept either common names or taxon IDs.

```
User says nothing          → taxon_id = [9606]              (human only)
User says "human, mouse"   → taxon_id = [9606, 10090]
User says "rat"            → taxon_id = [10116]
```

Common species lookup table:

| Species          | Common Name | Taxon ID |
|------------------|-------------|----------|
| Homo sapiens     | human       | 9606     |
| Mus musculus     | mouse       | 10090    |
| Rattus norvegicus| rat         | 10116    |
| Bos taurus       | cow         | 9913     |
| Canis lupus      | dog         | 9615     |
| Pan troglodytes  | chimpanzee  | 9598     |
| Macaca mulatta   | rhesus      | 9544     |

### Why This Matters
The raw `search_by_gene` response for BRCA1 returns 25 entries across species.
The human entry alone is 74,915 tokens. The 24 non-human entries add ~218,000 tokens of noise.
Filtering at call time eliminates this entirely rather than post-processing.

---

## 2. Post-Call Filtering

Even with a species filter, apply this secondary filter on the response to pick the best entry:

```python
def pick_best_entry(results: list, taxon_id: int) -> dict | None:
    # Prefer Swiss-Prot reviewed entries
    reviewed = [
        r for r in results
        if "reviewed" in r["entryType"]
        and r["organism"]["taxonId"] == taxon_id
    ]
    if reviewed:
        # Highest annotation score wins
        return max(reviewed, key=lambda r: r["annotationScore"])
    # Fall back to unreviewed if nothing else
    return next((r for r in results if r["organism"]["taxonId"] == taxon_id), None)
```

---

## 3. What to Strip and Why

### Strip: `references[]`
- **Token cost:** ~18,800 tokens (109 papers × 172 tokens each)
- **Why strip:** Full citation records (authors, journal, pages, DOI). All PubMed IDs are
  already embedded inline in `comments[].texts[].value` as `(PubMed:XXXXXXX)` strings.
  No information is lost.

### Strip: `evidences[]` arrays (everywhere)
- **Token cost:** ~15,000+ tokens spread across all sections
- **Why strip:** Every field at every nesting level carries `evidences: [{ evidenceCode, source, id }]`
  provenance arrays. These are for database curators tracing claims to sources.
  An LLM agent does not need to know which paper proved BRCA1 localizes to the nucleus.
  Strip recursively before any further processing.

### Strip: `features[]` — structural annotations
- **Token cost:** ~2,200 tokens
- **Types to strip:** `Beta strand`, `Helix`, `Turn` (39 entries)
- **Why strip:** Raw 3D structure annotations from PDB. Only useful for structural biology tools,
  not for a general bio agent reasoning about gene function or disease.

### Strip: `features[Natural variant]` — non-pathogenic
- **Token cost:** 170 variants × 118 tokens = ~20,170 tokens → reduced to ~1,500 tokens
- **Why strip:** Most variants are `"uncertain significance"` or `"benign"`. Keep only
  variants with `"pathogenic"` in description. Preserve `natural_variant_total_count`
  as a metadata field so the count is not lost.

### Strip: `uniProtKBCrossReferences[]` — data repositories
- **Token cost:** ~12,000 tokens of the 15,033 total
- **Databases to strip:** `PDB` (32), `PDBsum` (32), `RefSeq` (33, keep MANE-Select only),
  `EMBL` (16), `ProteomicsDB` (7), `CPTAC` (5), `EMDB` (5), `jPOST`, `MassIVE`,
  `Pumba`, `BioMuta`, `DMDM`, `Antibodypedia`, `CPTC`, `DNASU`, `BioGRID-ORCS`,
  `ChiTaRS`, `EvolutionaryTrace`, `GeneWiki`, `GenomeRNAi`, `PRO`, `RNAct`,
  `Bgee`, `ExpressionAtlas`, `PaxDb`, `PeptideAtlas`
- **Why strip:** Raw data repositories and expression databases. No semantic value
  for an agent doing gene/disease/drug reasoning.

### Strip: `GO` evidences within xrefs
- **Token cost:** ~3,000 tokens
- **Why strip:** Each of the 77 GO terms carries its own `evidences[]` array.
  Keep only the `GoTerm` value string (e.g. `"C:BRCA1-A complex"`).

### Strip: housekeeping fields
- **Fields:** `secondaryAccessions`, `entryAudit`, `extraAttributes`
- **Why strip:** Version history, checksums, sequence counts — database admin metadata.

---

## 4. What to Keep and Why

### Identity fields
| Field path | Keep | Why |
|---|---|---|
| `primaryAccession` | yes | Canonical UniProt ID, needed for downstream API calls |
| `uniProtkbId` | yes | Human-readable ID (e.g. `BRCA1_HUMAN`) |
| `annotationScore` | yes | Quality signal (1–5), used to select best entry |
| `proteinDescription.recommendedName.fullName.value` | yes | Protein name |
| `genes[0].geneName.value` | yes | Gene symbol |
| `organism.{scientificName, taxonId}` | yes | Species context |

### Functional annotation (from `comments`)
| `commentType` | Keep | What to extract |
|---|---|---|
| `FUNCTION` | yes | `texts[0].value` — most information-dense field in the response |
| `DISEASE` | yes | `disease.{diseaseId, description}` + `note.texts[0].value` |
| `SUBCELLULAR LOCATION` | yes | `subcellularLocations[].location.value` (location name only) |
| `SUBUNIT` | yes | `texts[0].value` — describes complexes and binding partners |
| `INTERACTION` | yes | `interactions[].{interactantTwo.geneName, numberOfExperiments}` only |
| `PATHWAY` | yes | `texts[0].value` |
| `TISSUE SPECIFICITY` | yes | `texts[0].value` |
| `CATALYTIC ACTIVITY` | conditional | Keep if the protein is an enzyme |
| `PTM` | conditional | Keep for phosphorylation/ubiquitination context if relevant |
| `WEB RESOURCE` | no | External links, not needed for agent reasoning |
| `SEQUENCE CAUTION` | no | Database curation notes |
| `CAUTION` | no | Database curation notes |

### Structural features (from `features[]`)
| `type` | Keep | Why |
|---|---|---|
| `Domain` | yes | Named domains with positions (e.g. BRCT 1, BRCT 2) |
| `Zinc finger` | yes | Functional structural motif |
| `Region` | yes | Functional regions (e.g. interaction interfaces) |
| `Natural variant` | filtered | Only `"pathogenic"` variants + total count |
| `Mutagenesis` | conditional | Keep if doing functional variant analysis |
| `Modified residue` | conditional | Keep if doing PTM analysis |
| `Cross-link` | no | Ubiquitination site details — too granular |
| `Alternative sequence` | no | Isoform sequence diffs |
| `Sequence conflict` | no | Database discrepancies |
| `Beta strand / Helix / Turn` | no | 3D structure data |
| `Compositional bias` | no | Low-complexity region annotations |

### Cross-references (from `uniProtKBCrossReferences[]`)
| Database | Keep | Why |
|---|---|---|
| `HGNC` | yes | Canonical human gene ID |
| `MIM` | yes | OMIM disease and gene links |
| `Reactome` | yes | Pathway names (PathwayName property only) |
| `GO` | yes | Term strings only, no evidences |
| `Ensembl` (MANE-Select only) | yes | Canonical transcript/gene ID |
| `ChEMBL` | yes | Drug target linkage |
| `ClinPGx` | yes | Pharmacogenomics linkage |
| `OpenTargets` | yes | Disease–target association linkage |
| `Orphanet` | yes | Rare disease context |
| `InterPro` | yes | Domain family classification |
| Everything else | no | See Strip section |

### Sequence
| Field | Keep | Why |
|---|---|---|
| `sequence.length` | yes | Protein size context |
| `sequence.molWeight` | yes | Physical property |
| `sequence.value` | no | Raw amino acid string — 1,863 chars, only needed for sequence analysis tools |

### Keywords
| Field | Keep | Why |
|---|---|---|
| `keywords[].name` | yes | 34 flat strings (~160 tokens). High signal for classification: `Tumor suppressor`, `DNA repair`, `Kinase`, etc. |

---

## 5. Token Budget Summary

| Stage | Tokens |
|---|---|
| Raw response (25 species entries) | ~293,000 |
| After species filter (human only) | ~74,915 |
| After full extraction | ~1,500–2,500 |
| **Total reduction** | **97–98%** |

---

## 6. Extraction Schema (Reference)

```python
def extract_uniprot_entry(entry: dict) -> dict:
    comments_by_type: dict[str, list] = {}
    for c in entry.get("comments", []):
        comments_by_type.setdefault(c["commentType"], []).append(c)

    def text(comment_list: list) -> str | None:
        return comment_list[0].get("texts", [{}])[0].get("value") if comment_list else None

    pathogenic_variants = [
        {
            "position": f["location"]["start"]["value"],
            "description": f["description"],
            "change": (
                f"{f['alternativeSequence']['originalSequence']}"
                f"->{f['alternativeSequence']['alternativeSequences'][0]}"
            ) if f.get("alternativeSequence") else None,
        }
        for f in entry.get("features", [])
        if f["type"] == "Natural variant" and "pathogenic" in f.get("description", "").lower()
    ]

    def xrefs_for(db: str, prop_key: str | None = None) -> list:
        matches = [x for x in entry.get("uniProtKBCrossReferences", []) if x["database"] == db]
        if prop_key is None:
            return [x.get("id") for x in matches]
        return [
            next((p["value"] for p in x.get("properties", []) if p["key"] == prop_key), None)
            for x in matches
        ]

    return {
        # Identity
        "accession": entry["primaryAccession"],
        "id": entry["uniProtkbId"],
        "name": entry["proteinDescription"]["recommendedName"]["fullName"]["value"],
        "gene": entry["genes"][0]["geneName"]["value"] if entry.get("genes") else None,
        "organism": entry["organism"]["scientificName"],
        "taxon_id": entry["organism"]["taxonId"],
        "annotation_score": entry["annotationScore"],
        # Sequence
        "sequence_length": entry["sequence"]["length"],
        "mol_weight": entry["sequence"]["molWeight"],
        # Functional
        "function": text(comments_by_type.get("FUNCTION", [])),
        "subunit": text(comments_by_type.get("SUBUNIT", [])),
        "pathway": text(comments_by_type.get("PATHWAY", [])),
        "tissue_specificity": text(comments_by_type.get("TISSUE SPECIFICITY", [])),
        # Disease
        "diseases": [
            {
                "name": c["disease"]["diseaseId"],
                "description": c["disease"].get("description"),
                "note": c.get("note", {}).get("texts", [{}])[0].get("value"),
            }
            for c in comments_by_type.get("DISEASE", [])
        ],
        # Localization
        "subcellular_locations": list({
            loc["location"]["value"]
            for c in comments_by_type.get("SUBCELLULAR LOCATION", [])
            for loc in c.get("subcellularLocations", [])
        }),
        # Interactions (top 20 by experiment count)
        "interactions": sorted(
            [
                {"gene": i["interactantTwo"].get("geneName"), "n_experiments": i["numberOfExperiments"]}
                for c in comments_by_type.get("INTERACTION", [])
                for i in c.get("interactions", [])
                if i["interactantTwo"].get("geneName")
            ],
            key=lambda x: -x["n_experiments"]
        )[:20],
        # Features
        "domains": [
            {"name": f["description"], "start": f["location"]["start"]["value"], "end": f["location"]["end"]["value"]}
            for f in entry.get("features", [])
            if f["type"] in ("Domain", "Zinc finger", "Region")
        ],
        "natural_variants": {
            "total_count": sum(1 for f in entry.get("features", []) if f["type"] == "Natural variant"),
            "pathogenic": pathogenic_variants,
        },
        # Keywords
        "keywords": [k["name"] for k in entry.get("keywords", [])],
        # Cross-references
        "xrefs": {
            "hgnc": next(iter(xrefs_for("HGNC")), None),
            "omim": xrefs_for("MIM"),
            "ensembl_gene": next(
                (
                    next((p["value"] for p in x.get("properties", []) if p["key"] == "GeneId"), None)
                    for x in entry.get("uniProtKBCrossReferences", [])
                    if x["database"] == "Ensembl"
                ),
                None
            ),
            "chembl": next(iter(xrefs_for("ChEMBL")), None),
            "open_targets": next(iter(xrefs_for("OpenTargets")), None),
            "clinpgx": next(iter(xrefs_for("ClinPGx")), None),
            "reactome_pathways": xrefs_for("Reactome", "PathwayName"),
            "go_terms": xrefs_for("GO", "GoTerm"),
            "orphanet": xrefs_for("Orphanet", "Disease"),
            "interpro": xrefs_for("InterPro", "EntryName"),
        },
    }
```

---

## 7. Agent Tool Wrapper Design

```python
async def search_gene_uniprot(
    gene: str,
    species: list[str] | None = None,  # None → default human
) -> dict:
    """
    species: list of common names or taxon IDs, e.g. ["human"], ["human", "mouse"], [9606, 10090]
    """
    SPECIES_MAP = {
        "human": 9606, "homo sapiens": 9606,
        "mouse": 10090, "mus musculus": 10090,
        "rat": 10116, "rattus norvegicus": 10116,
        "cow": 9913, "bos taurus": 9913,
        "dog": 9615, "canis lupus": 9615,
        "chimpanzee": 9598, "pan troglodytes": 9598,
        "rhesus": 9544, "macaca mulatta": 9544,
    }

    # Resolve species to taxon IDs
    if species is None:
        taxon_ids = [9606]
    else:
        taxon_ids = [
            SPECIES_MAP.get(s.lower(), int(s)) if not str(s).isdigit() else int(s)
            for s in species
        ]

    # Call UniProt for each taxon (or pass list if tool supports it)
    all_results = []
    for taxon_id in taxon_ids:
        raw = await mcp_uniprot_search_by_gene(gene=gene, taxon_id=taxon_id)
        best = pick_best_entry(raw["results"], taxon_id)
        if best:
            all_results.append(extract_uniprot_entry(best))

    return {"gene": gene, "species_results": all_results}
```
