/**
 * Live round-trip against Langfuse (opt-in: writes to the project).
 *
 *   EVAL_SYNC_ROUNDTRIP=1 bun test evals/__tests__/sync-roundtrip.test.ts
 *
 * Pushes a probe item with awkward shapes (nulls, unicode, nested arrays, floats, empty
 * containers) to the `eval-sync-roundtrip` dataset, fetches it back, and checks the hash
 * recomputed from the fetched payload equals the local one. Catches any normalization
 * Langfuse applies. The probe item is deleted afterwards; the API cannot delete
 * datasets, so the empty `eval-sync-roundtrip` dataset stays (delete it in the UI).
 */
import { describe, expect, it } from "bun:test";
import { contentHash } from "../lib/hash";
import { langfuseApiFromEnv } from "../lib/langfuse-api";
import { loadEvalHome } from "../lib/load";
import { remoteContentHash } from "../lib/plan";

const enabled = process.env.EVAL_SYNC_ROUNDTRIP === "1";
const DATASET = "eval-sync-roundtrip";

describe.skipIf(!enabled)("eval sync round-trip (live Langfuse)", () => {
  it("fetched item hashes to the local content_hash", async () => {
    const api = langfuseApiFromEnv();
    await api.upsertDataset({
      name: DATASET,
      description: "Probe items for evals/__tests__/sync-roundtrip.test.ts. Safe to ignore.",
      metadata: { purpose: "hash round-trip probe" },
    });

    const probe = {
      input: { turns: ["Ünïcödé – “quotes” \"escaped\"\nnew line\ttab", "😀 emoji"] },
      expected_output: {
        checkpoints: [{ turn: 1, any_of: [["a", "b"], ["1.0"]], min_hits: 1 }],
        reference_answer: null,
        nested: { z: [1, 1.5, -0.25, 1e21, 0], a: {}, m: [] },
      },
      metadata: { reviewed_by: null, volatile: false, notes: "", score: 0.1 },
    };
    const local = contentHash(probe);
    const body = {
      id: "eval-sync-roundtrip-probe",
      datasetName: DATASET,
      input: probe.input,
      expectedOutput: probe.expected_output,
      metadata: { ...probe.metadata, content_hash: local },
      status: "ACTIVE" as const,
    };

    await api.upsertItem(body);
    try {
      const fetched = await api.getItem(body.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.status).toBe("ACTIVE");
      expect(fetched!.metadata?.content_hash).toBe(local);
      expect(remoteContentHash(fetched!)).toBe(local);
    } finally {
      await api.deleteItem(body.id);
    }
  }, 30_000);

  it("synced smoke/deep items hash to their local content_hash", async () => {
    const api = langfuseApiFromEnv();
    for (const { dataset } of loadEvalHome().datasets) {
      const remote = new Map((await api.listItems(dataset.name)).map((i) => [i.id, i]));
      for (const item of dataset.items) {
        const fetched = remote.get(item.id);
        if (!fetched) throw new Error(`${dataset.name}/${item.id} not synced; run bun run eval:sync --apply`);
        expect(remoteContentHash(fetched)).toBe(contentHash(item));
      }
    }
  }, 60_000);
});
