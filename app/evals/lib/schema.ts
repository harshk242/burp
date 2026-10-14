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
    turns: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const ExpectedOutputSchema = z
  .object({
    checkpoints: z.array(CheckpointSchema),
    expected_tools_any: z.array(z.string().min(1)).optional(),
    must_not: z.array(z.string().min(1)).optional(),
    key_references: z.array(z.string().min(1)).optional(),
    reference_answer: z.string().min(1).nullable(),
  })
  .strict();

export const ItemMetadataSchema = z
  .object({
    category: z.enum(CATEGORIES),
    turns: z.enum(["single", "multi"]),
    difficulty: z.enum(["easy", "medium", "hard"]),
    volatile: z.boolean(),
    source: z
      .string()
      .regex(
        /^(hand-written|prod-trace|target-selection-pack|trace:[A-Za-z0-9_-]+)$/,
        "hand-written | prod-trace | target-selection-pack | trace:<id>",
      ),
    reviewed_by: z.string().min(1).nullable(),
    notes: z.string(),
    prompt_version: z.string().min(1).optional(),
    source_files: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const DatasetItemSchema = z
  .object({
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
    name: slug,
    description: z.string().min(1),
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

const metricName = z
  .string()
  .max(35)
  .regex(/^[a-z][a-z0-9_]*$/, "snake_case, starting with a letter");

export const MetricSchema = z
  .object({
    name: metricName,
    description: z.string().min(1),
    method: z.enum(["code", "semantic", "judge", "human"]),
    data_type: z.enum(["NUMERIC", "BOOLEAN", "CATEGORICAL"]),
    categories: z.array(z.string().min(1)).min(2).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    scope: z.array(z.enum(["online", "offline"])).min(1),
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

export function isEligibleForPassFail(item: DatasetItem): boolean {
  return item.metadata.reviewed_by !== null;
}
