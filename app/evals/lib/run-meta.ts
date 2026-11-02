import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { sha256Hex } from "./hash";
import { EVALS_DIR } from "./load";

export const APP_DIR = join(EVALS_DIR, "..");

export interface NameParts {
  dataset: string;
  gitSha: string;
  model: string;
  effort: string;
  armNote?: string | null;
  note: string | null;
  repeatIndex: number;
  repeatCount: number;
}

export function experimentName(p: NameParts): string {
  const parts = [p.dataset, p.gitSha, p.model, p.effort];
  if (p.armNote) parts.push(p.armNote);
  if (p.note) parts.push(p.note);
  if (p.repeatCount > 1) parts.push(`r${p.repeatIndex}`);
  return parts.join("-");
}

function git(args: string[]): string | null {
  const res = Bun.spawnSync(["git", ...args], { cwd: APP_DIR, stdout: "pipe", stderr: "pipe" });
  return res.exitCode === 0 ? res.stdout.toString().trim() : null;
}

export function gitState(): { sha: string; dirty: boolean } {
  const sha = process.env.GIT_SHA || git(["rev-parse", "--short", "HEAD"]) || "unknown";
  const status = git(["status", "--porcelain"]);
  return { sha, dirty: status === null ? true : status.length > 0 };
}

function filesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap((name) => filesUnder(join(path, name)));
}

export function hashFiles(paths: string[]): string {
  const files = paths
    .flatMap(filesUnder)
    .filter((f) => !f.includes("__tests__"))
    .map((f) => relative(APP_DIR, f))
    .sort();
  return sha256Hex(files.map((f) => `${f}\0${sha256Hex(readFileSync(join(APP_DIR, f), "utf8"))}`).join("\n"));
}

export interface ScoringHashes {
  evaluators_hash: string;
  metrics_hash: string;
  rubric_hashes: Record<string, string>;
}

export function scoringHashes(rubrics: string[]): ScoringHashes {
  return {
    evaluators_hash: hashFiles([join(EVALS_DIR, "evaluators"), join(APP_DIR, "server/observability/turn-signals.ts")]),
    metrics_hash: hashFiles([join(EVALS_DIR, "metrics.yaml")]),
    rubric_hashes: Object.fromEntries(rubrics.sort().map((r) => [r, hashFiles([join(EVALS_DIR, r)])])),
  };
}

export interface SearchState {
  tools_available: number;
  search_mode: "hybrid" | "keyword";
  embedder: string | null;
}

export interface RunMetadataInput {
  model: string;
  provider: string;
  effort: string;
  thinkingDisplay: string;
  maxOutputTokens: number;
  maxOutputTokensSource: string;
  maxContextTokens: number;
  comparisonGroup: string;
  arm: string;
  armIndex: number;
  armCount: number;
  contextVersion: string;
  git: { sha: string; dirty: boolean };
  datasetName: string;
  datasetVersion: string;
  datasetHash: string;
  datasetVersionPinned: boolean;
  scoring: ScoringHashes;
  search: SearchState;
  runId: string;
  repeatGroup: string;
  repeatIndex: number;
  repeatCount: number;
  maxCostUsd: number;
  concurrency: number;
  items: string[] | null;
}

export function runMetadata(m: RunMetadataInput): Record<string, unknown> {
  return {
    model: m.model,
    provider: m.provider,
    effort: m.effort,
    thinking_display: m.thinkingDisplay,
    max_output_tokens: m.maxOutputTokens,
    max_output_tokens_source: m.maxOutputTokensSource,
    max_context_tokens: m.maxContextTokens,
    comparison_group: m.comparisonGroup,
    arm: m.arm,
    arm_index: m.armIndex,
    arm_count: m.armCount,
    context_version: m.contextVersion,
    git_sha: m.git.sha,
    git_dirty: m.git.dirty,
    dataset: m.datasetName,
    dataset_version: m.datasetVersion,
    dataset_hash: m.datasetHash,
    dataset_local_check: m.datasetVersionPinned ? "skipped (--dataset-version)" : "verified",
    ...m.scoring,
    ...m.search,
    run_id: m.runId,
    repeat_group: m.repeatGroup,
    repeat_index: m.repeatIndex,
    repeat_count: m.repeatCount,
    max_cost_usd: m.maxCostUsd,
    concurrency: m.concurrency,
    ...(m.items ? { items: m.items } : {}),
  };
}
