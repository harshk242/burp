/**
 * Comparison arms (plan 2.4): one Anthropic setup (model + effort, optional
 * max_output_tokens) per experiment. Arms come from git-tracked matrix files
 * (`app/evals/matrices/<name>.yaml`) and/or repeatable `--arm
 * <model>:<effort>[:<max_output_tokens>]`. No arm = the production config.
 *
 * Pure (fs + YAML only): args.ts parses `--arm` before run.ts sets up the
 * environment. Whether a model exists and takes the effort level is checked
 * later against the Models API (capabilities.ts), never from a local table.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Effort, LLMConfig } from "../../server/llm/config";
import { EVALS_DIR, parseYaml, validate } from "./load";

export const MATRICES_DIR = join(EVALS_DIR, "matrices");

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly Effort[];

/**
 * Default max_output_tokens for an arm that doesn't set one. Thinking counts
 * toward it, so the production 16k cap would cut xhigh/max answers; capped at
 * the model's own output limit (Models API `max_tokens`).
 */
export const DEFAULT_ARM_MAX_OUTPUT_TOKENS = 64_000;

const MODEL_ID = /^[a-z0-9][a-z0-9.-]*$/;
const NOTE = /^[A-Za-z0-9._-]+$/;

export const ArmSpecSchema = z
  .object({
    model: z.string().regex(MODEL_ID, "model must be an Anthropic model id like claude-sonnet-5-5"),
    effort: z.enum(EFFORT_LEVELS),
    max_output_tokens: z.number().int().positive().optional(),
    /** Appended to the experiment name; tells apart arms with the same model and effort. */
    note: z.string().regex(NOTE, 'note may only use letters, digits, ".", "_" and "-"').optional(),
  })
  .strict();

export type ArmSpec = z.infer<typeof ArmSpecSchema>;

export const MatrixFileSchema = z
  .object({
    description: z.string().optional(),
    arms: z.array(ArmSpecSchema).min(1),
  })
  .strict();

export class ArmsError extends Error {}

/** `<model>:<effort>[:<max_output_tokens>]`. Throws ArmsError. */
export function parseArmFlag(value: string): ArmSpec {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new ArmsError(`--arm must be <model>:<effort>[:<max_output_tokens>], got "${value}"`);
  }
  const [model, effort, maxOut] = parts as [string, string, string | undefined];
  if (!MODEL_ID.test(model)) throw new ArmsError(`--arm "${value}": "${model}" is not a model id (e.g. claude-sonnet-5-5)`);
  if (!(EFFORT_LEVELS as readonly string[]).includes(effort)) {
    throw new ArmsError(`--arm "${value}": effort must be one of ${EFFORT_LEVELS.join(", ")}, got "${effort}"`);
  }
  const arm: ArmSpec = { model, effort: effort as Effort };
  if (maxOut !== undefined) {
    const n = Number(maxOut);
    if (!Number.isInteger(n) || n < 1) throw new ArmsError(`--arm "${value}": max_output_tokens must be a positive integer, got "${maxOut}"`);
    arm.max_output_tokens = n;
  }
  return arm;
}

export function matrixNames(dir: string = MATRICES_DIR): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => f.replace(/\.ya?ml$/, "")).sort() : [];
}

/** Loads `matrices/<name>.yaml`. Throws ArmsError with file:line problems. */
export function loadMatrix(name: string, dir: string = MATRICES_DIR): ArmSpec[] {
  const file = ["yaml", "yml"].map((ext) => join(dir, `${name}.${ext}`)).find((f) => existsSync(f));
  if (!/^[A-Za-z0-9._-]+$/.test(name) || !file) {
    throw new ArmsError(`unknown matrix "${name}" (have: ${matrixNames(dir).join(", ") || "none"})`);
  }
  const { parsed, problems } = parseYaml(file, dir);
  const matrix = parsed ? validate(MatrixFileSchema, parsed, problems) : undefined;
  if (!matrix) throw new ArmsError(`matrix ${name} failed validation:\n  ${problems.join("\n  ")}`);
  return matrix.arms;
}

/** The arm's part of the experiment name: `<model>-<effort>[-<note>]`. */
export function armLabel(arm: Pick<ArmSpec, "model" | "effort" | "note">): string {
  return [arm.model, arm.effort, ...(arm.note ? [arm.note] : [])].join("-");
}

/** Matrix arms then `--arm` arms; fails when two would share an experiment name. */
export function combineArms(matrix: ArmSpec[], flags: ArmSpec[]): ArmSpec[] {
  const arms = [...matrix, ...flags];
  const seen = new Set<string>();
  for (const arm of arms) {
    const label = armLabel(arm);
    if (seen.has(label)) throw new ArmsError(`two arms are both "${label}": give one a note (matrix files) so experiment names stay distinct`);
    seen.add(label);
  }
  return arms;
}

/** An arm with everything the run needs; `override` is what processChat gets (none for the config arm). */
export interface ResolvedArm {
  label: string;
  provider: LLMConfig["provider"];
  model: string;
  effort: Effort;
  note: string | null;
  maxOutputTokens: number;
  /** Where max_output_tokens came from. */
  maxOutputTokensSource: "arm" | "default" | "config";
  thinkingDisplay: LLMConfig["thinkingDisplay"];
  /** Same for every arm: the history budget must not confound the comparison. */
  maxContextTokens: number;
  override?: { model: string; effort: Effort; max_output_tokens: number };
}

/** The production config as the single arm (no --arm / --matrix): processChat gets no override. */
export function configArm(config: LLMConfig): ResolvedArm {
  return {
    label: armLabel({ model: config.chatModel, effort: config.effort }),
    provider: config.provider,
    model: config.chatModel,
    effort: config.effort,
    note: null,
    maxOutputTokens: config.maxOutputTokens,
    maxOutputTokensSource: "config",
    thinkingDisplay: config.thinkingDisplay,
    maxContextTokens: config.maxContextTokens,
  };
}

/** Applies the default max_output_tokens (capped at the model's output limit, when known). */
export function resolveArm(arm: ArmSpec, config: LLMConfig, modelMaxTokens?: number): ResolvedArm {
  const fallback = Math.min(DEFAULT_ARM_MAX_OUTPUT_TOKENS, modelMaxTokens ?? Infinity);
  const maxOutputTokens = arm.max_output_tokens ?? fallback;
  return {
    label: armLabel(arm),
    provider: config.provider,
    model: arm.model,
    effort: arm.effort,
    note: arm.note ?? null,
    maxOutputTokens,
    maxOutputTokensSource: arm.max_output_tokens === undefined ? "default" : "arm",
    thinkingDisplay: config.thinkingDisplay,
    maxContextTokens: config.maxContextTokens,
    override: { model: arm.model, effort: arm.effort, max_output_tokens: maxOutputTokens },
  };
}
