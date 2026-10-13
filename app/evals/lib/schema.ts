/**
 * Zod schemas for eval datasets and the metrics registry: the single source of truth.
 * The YAML files under app/evals/ are validated against these by load.ts, and sync.ts
 * pushes the parsed objects to Langfuse unchanged (plus content_hash).
 *
 * `input`, `expected_output` and `metadata` stay separate (Langfuse dataset rule):
 * reviewer notes and checkpoints never go in `input`.
 */
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lower-case kebab-case slug");

export const CATEGORIES = [
  "lookup",
  "cross-db",
  "drug-target",
  "variant",
  "trials",
  "regulatory",
  "out-of-scope",
  "target-selection",
] as const;

/** One checkpoint: `any_of` is a list of alias groups; a group hits when any alias appears. */
export const CheckpointSchema = z
  .object({
    turn: z.number().int().min(1),
    any_of: z.array(z.array(z.string().min(1)).min(1)).min(1),
    min_hits: z.number().int().min(1),
  })
  .strict()
  .refine((c) => c.min_hits <= c.any_of.length, {
    message: "min_hits cannot exceed the number of alias groups",
    path: ["min_hits"],
  });

export const ItemInputSchema = z
  .object({
    /** One entry = single-turn; each entry is sent as one user message, in order. */
    turns: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const ExpectedOutputSchema = z
  .object({
    checkpoints: z.array(CheckpointSchema),
    /** Tool-name globs; calling any one satisfies `expected_tool_coverage`. */
    expected_tools_any: z.array(z.string().min(1)).optional(),
    /** Human/judge notes for now; not machine-scored in v0. */
    must_not: z.array(z.string().min(1)).optional(),
    /** Sources a reviewer expects to see (e.g. "PMID:28304224"). Informational. */
    key_references: z.array(z.string().min(1)).optional(),
    reference_answer: z.string().min(1).nullable(),
  })
  .strict();

export const ItemMetadataSchema = z
  .object({
    category: z.enum(CATEGORIES),
    turns: z.enum(["single", "multi"]),
    difficulty: z.enum(["easy", "medium", "hard"]),
    /** true = live data changes (trial counts, approvals): checkpoints only. */
    volatile: z.boolean(),
    source: z
      .string()
      .regex(
        /^(hand-written|prod-trace|target-selection-pack|trace:[A-Za-z0-9_-]+)$/,
        "hand-written | prod-trace | target-selection-pack | trace:<id>",
      ),
    /** An item counts toward scores only once a human has reviewed it. */
    reviewed_by: z.string().min(1).nullable(),
    notes: z.string(),
    prompt_version: z.string().min(1).optional(),
    source_files: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const DatasetItemSchema = z
  .object({
    /** Stable; becomes the Langfuse dataset item id (unique across the whole project). */
    id: slug.max(100),
    input: ItemInputSchema,
    expected_output: ExpectedOutputSchema,
    metadata: ItemMetadataSchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    const n = item.input.turns.length;
    const expected = n === 1 ? "single" : "multi";
    if (item.metadata.turns !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `metadata.turns must be "${expected}" for ${n} input turn(s)`,
        path: ["metadata", "turns"],
      });
    }
    item.expected_output.checkpoints.forEach((c, i) => {
      if (c.turn > n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `checkpoint turn ${c.turn} exceeds the item's ${n} input turn(s)`,
          path: ["expected_output", "checkpoints", i, "turn"],
        });
      }
    });
  });

export const DatasetFileSchema = z
  .object({
    /** Langfuse dataset name. */
    name: slug,
    description: z.string().min(1),
    /** Runner hints (Phase 2); stored in dataset metadata. */
    run_defaults: z
      .object({
        concurrency: z.number().int().min(1).optional(),
        max_cost_usd: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    items: z.array(DatasetItemSchema).min(1),
  })
  .strict();

/** Langfuse config names: max 35 chars; we further restrict to snake_case. */
const metricName = z
  .string()
  .max(35)
  .regex(/^[a-z][a-z0-9_]*$/, "snake_case, starting with a letter");

export const MetricSchema = z
  .object({
    /** Score name in Langfuse. A changed definition needs a new name, never an edit. */
    name: metricName,
    description: z.string().min(1),
    method: z.enum(["code", "semantic", "judge", "human"]),
    data_type: z.enum(["NUMERIC", "BOOLEAN", "CATEGORICAL"]),
    categories: z.array(z.string().min(1)).min(2).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    scope: z.array(z.enum(["online", "offline"])).min(1),
    /** Path relative to app/evals/, or null for objective metrics. */
    rubric: z
      .string()
      .regex(/^rubrics\/[a-z0-9-]+\.md$/, "rubrics/<slug>.md")
      .nullable(),
    status: z.enum(["draft", "active", "retired"]),
  })
  .strict()
  .superRefine((m, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
    if (m.data_type === "CATEGORICAL" && !m.categories) issue("CATEGORICAL metrics need categories", "categories");
    if (m.data_type !== "CATEGORICAL" && m.categories) issue("only CATEGORICAL metrics take categories", "categories");
    if (m.data_type !== "NUMERIC" && (m.min !== undefined || m.max !== undefined)) {
      issue("only NUMERIC metrics take min/max", m.min !== undefined ? "min" : "max");
    }
    if (m.min !== undefined && m.max !== undefined && m.min >= m.max) issue("min must be below max", "max");
    if (m.categories && new Set(m.categories).size !== m.categories.length) issue("duplicate category", "categories");
  });

export const MetricsFileSchema = z.array(MetricSchema).min(1);

export type Checkpoint = z.infer<typeof CheckpointSchema>;
export type DatasetItem = z.infer<typeof DatasetItemSchema>;
export type DatasetFile = z.infer<typeof DatasetFileSchema>;
export type Metric = z.infer<typeof MetricSchema>;

/** Unreviewed items still run, but never count toward pass/fail. */
export function countsTowardScores(item: DatasetItem): boolean {
  return item.metadata.reviewed_by !== null;
}
