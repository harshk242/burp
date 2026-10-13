# id_grounding

**Definition:** the share of database identifiers in each answer that appear in evidence the model had
*before* writing that answer. Evidence for the answer to turn k:

- user messages of turns 1..k
- tool outputs of earlier `ok` turns (only those are replayed; failed-turn outputs never reach the model)
- tool outputs of turn k itself

Evidence from later turns never counts.

**Identifiers:** PMID, NCT, UniProt accession, CHEMBL, rsID, ENSG/ENST, R-HSA, VCV/RCV, PubChem CID.

**Scale:** 0–1, pooled over all answers in the item (grounded IDs / cited IDs). Not scored (no score
written) when no answer cites an identifier.

**Pass bar:** 1.0 for smoke items. Each ungrounded ID is listed in the score comment with its turn number.

## Examples

- **PASS:** the answer cites PMID 28304224 (FOURIER), and that PMID appears in a `pubmed__search_pubmed`
  output. → 1.0
- **FAIL:** the answer cites "NCT04123456 is recruiting" and one grounded NCT ID; no clinicaltrials tool
  output contains NCT04123456. → 0.5 (1 of 2 grounded)
- **FAIL (leakage):** turn 1 invents CHEMBL123; turn 2 retrieves CHEMBL123. Turn 1's citation stays
  ungrounded.

## Known limits

Catches fabricated IDs, not a real ID attached to the wrong claim (judge territory, Phase 5).
