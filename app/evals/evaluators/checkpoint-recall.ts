/**
 * checkpoint_recall (rubrics/checkpoint-recall.md): the share of an item's
 * checkpoints met by the final answer to their own turn. An alias group hits
 * when any alias appears case-insensitively with no letter or digit right
 * before or after it (so `IL-23` does not match `IL-23R`); a checkpoint passes
 * with at least `min_hits` groups. A failed turn (no answer) fails its
 * checkpoints. Not scored when the item has no checkpoints.
 */
import type { Checkpoint } from "../lib/schema";
import type { ItemEvaluator } from "./types";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function aliasHits(alias: string, answer: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(alias)}(?![\\p{L}\\p{N}])`, "iu").test(answer);
}

/** Alias groups of `checkpoint` that missed in `answer` (all of them when there is no answer). */
export function missedGroups(checkpoint: Checkpoint, answer: string | null): string[][] {
  return checkpoint.any_of.filter((group) => !answer || !group.some((alias) => aliasHits(alias, answer)));
}

export const checkpointRecall: ItemEvaluator = (output, item) => {
  if (output.skipped) return null;
  const checkpoints = item.expected_output.checkpoints;
  if (checkpoints.length === 0) return null;
  const failed: string[] = [];
  for (const [i, cp] of checkpoints.entries()) {
    const answer = output.turns.find((t) => t.turn === cp.turn)?.answer ?? null;
    const missed = missedGroups(cp, answer);
    const hits = cp.any_of.length - missed.length;
    if (hits >= cp.min_hits) continue;
    const why = answer === null ? "no answer" : `${hits}/${cp.min_hits} hits; missed ${missed.map((g) => g[0]).join(", ")}`;
    failed.push(`checkpoint ${i + 1} (turn ${cp.turn}): ${why}`);
  }
  const passed = checkpoints.length - failed.length;
  return {
    name: "checkpoint_recall",
    value: passed / checkpoints.length,
    dataType: "NUMERIC",
    comment: failed.length ? failed.join("; ") : `${passed} of ${checkpoints.length} checkpoints met`,
    metadata: { passed, total: checkpoints.length },
  };
};
