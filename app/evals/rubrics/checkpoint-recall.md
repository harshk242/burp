# checkpoint_recall

**Definition:** the share of an item's `expected_output.checkpoints` that the answers meet. A checkpoint
belongs to one turn and is checked only against the final answer to that turn:

- `any_of` is a list of alias groups (e.g. `[[osimertinib, tagrisso], [gefitinib, iressa]]`).
- A group hits when any of its aliases appears in the answer: case-insensitive, matched on word
  boundaries, so `IL-23` does not match `IL-23R`.
- The checkpoint passes when at least `min_hits` groups hit.

**Scale:** 0–1 = passed checkpoints / total checkpoints for the item. Not scored when the item has no
checkpoints (e.g. out-of-scope items, which rely on `must_not` review instead). A turn that failed (no
answer) fails all its checkpoints.

**Pass bar:** 1.0 for reviewed smoke items. The score comment lists each failed checkpoint with its turn
and the groups that missed.

## Examples

- **PASS:** checkpoint `{ turn: 1, any_of: [[osimertinib, tagrisso], [gefitinib, iressa], [erlotinib,
  tarceva], [afatinib, gilotrif]], min_hits: 3 }`; the turn-1 answer names Tagrisso, gefitinib and
  erlotinib. → 3 hits ≥ 3 → 1.0
- **FAIL:** the same checkpoint; the answer names only osimertinib and cetuximab. → 1 hit < 3 → 0.0
- **FAIL (wrong turn):** a turn-2 checkpoint for `Journavx` where only the turn-1 answer mentions it.
  Earlier answers never satisfy a later turn's checkpoint. → 0.0

## Known limits

String presence, not meaning: "PCSK9 is *not* a good target" still hits `PCSK9`. Checkpoints are
recall signals, not the only acceptable answers (see the target-selection evaluator guide); correctness
of the surrounding claims is judge or human territory. Volatile items (`metadata.volatile: true`) should
only use checkpoints that stay true as live data changes.
