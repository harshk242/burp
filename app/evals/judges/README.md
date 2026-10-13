# Judges (Phase 5)

Empty for now. Each LLM judge will live here as `<metric>.md`: the judge prompt with its rubric and
1–2 examples, versioned in git.

A judge metric is added to `../metrics.yaml` with `method: judge` and `status: draft`, and becomes
`active` only after it meets its agreement bar (TPR/TNR against held-out human labels). Re-check
agreement whenever the judge prompt, judge model or agent changes. Anthropic models only.

Candidates: `claim_support`, `intervention_direction`, `counterevidence_handling`,
`disease_specificity`, `limitation_disclosure`.
