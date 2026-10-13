# Failure modes

Output of Phase 4 error analysis (`plans/eval-pipeline-langfuse-plan.md`). Empty until traces have
been reviewed.

**Process:** read about 30 traces from the Langfuse annotation queue (negative `user_feedback`,
`turn_outcome != ok`, `answer_truncated`, smoke/deep experiment failures, ~10 random prod traces as a
baseline). Write one note per trace on the first, most upstream failure. Group the notes into modes
below and keep reviewing until new traces stop adding modes.

**Severity:** `critical` (wrong or fabricated decisive claim), `major` (answer unusable or misleading),
`minor` (degraded but usable).

| Mode | Definition (one line) | Count | Severity | Example traces | Action |
|---|---|---|---|---|---|
| _name_ | _what goes wrong, observable in the trace_ | 0 | _critical / major / minor_ | _links_ | _fix list / eval candidate_ |

## Fix list

Obvious causes to fix directly.

## Eval candidates

Likely to recur or needing nuance; promote to dataset items (`source: trace:<id>`) or judge metrics.
