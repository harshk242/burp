/**
 * YAML → validated objects. Fails fast with `file:line:col` errors: YAML syntax errors
 * and schema issues are mapped back to the source position of the offending node.
 *
 * Cross-file checks: dataset names unique, item ids unique across ALL datasets
 * (Langfuse item ids are project-wide), metric names unique, rubric files exist.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isNode, LineCounter, parseDocument, type Document } from "yaml";
import type { z } from "zod";
import { DatasetFileSchema, MetricsFileSchema, type DatasetFile, type Metric } from "./schema";

export const EVALS_DIR = join(import.meta.dir, "..");

export class EvalLoadError extends Error {
  constructor(readonly problems: string[]) {
    super(`eval files failed validation:\n  ${problems.join("\n  ")}`);
    this.name = "EvalLoadError";
  }
}

export interface LoadedDataset {
  /** Path relative to app/evals/, e.g. "datasets/smoke-v0.yaml". */
  file: string;
  dataset: DatasetFile;
}

export interface EvalHome {
  datasets: LoadedDataset[];
  metrics: Metric[];
}

interface ParsedYaml {
  doc: Document.Parsed;
  lines: LineCounter;
  file: string;
}

function parseYaml(absPath: string, rootDir: string): { parsed?: ParsedYaml; problems: string[] } {
  const file = relative(rootDir, absPath);
  const lines = new LineCounter();
  const doc = parseDocument(readFileSync(absPath, "utf8"), { lineCounter: lines, prettyErrors: false });
  const problems = doc.errors.map((e) => {
    const pos = lines.linePos(e.pos[0]);
    return `${file}:${pos.line}:${pos.col}: YAML ${e.code}: ${e.message.split("\n")[0]}`;
  });
  return { parsed: problems.length ? undefined : { doc, lines, file }, problems };
}

/** Source position of the deepest existing node on `path`. */
function locate({ doc, lines, file }: ParsedYaml, path: ReadonlyArray<string | number>): string {
  for (let depth = path.length; depth >= 0; depth--) {
    const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
    if (isNode(node) && node.range) {
      const pos = lines.linePos(node.range[0]);
      return `${file}:${pos.line}:${pos.col}`;
    }
  }
  return `${file}:1:1`;
}

function validate<S extends z.ZodTypeAny>(
  schema: S,
  parsed: ParsedYaml,
  problems: string[],
): z.infer<S> | undefined {
  const result = schema.safeParse(parsed.doc.toJS());
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const where = locate(parsed, issue.path);
    problems.push(`${where}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  return undefined;
}

/** Loads and validates every eval file under `rootDir`. Throws EvalLoadError listing all problems. */
export function loadEvalHome(rootDir: string = EVALS_DIR): EvalHome {
  const problems: string[] = [];
  const datasets: LoadedDataset[] = [];
  const itemOwner = new Map<string, string>();
  const datasetOwner = new Map<string, string>();

  const datasetDir = join(rootDir, "datasets");
  const datasetFiles = existsSync(datasetDir)
    ? readdirSync(datasetDir).filter((f) => /\.ya?ml$/.test(f)).sort()
    : [];
  for (const name of datasetFiles) {
    const { parsed, problems: yamlProblems } = parseYaml(join(datasetDir, name), rootDir);
    problems.push(...yamlProblems);
    if (!parsed) continue;
    const dataset = validate(DatasetFileSchema, parsed, problems);
    if (!dataset) continue;

    const prior = datasetOwner.get(dataset.name);
    if (prior) problems.push(`${locate(parsed, ["name"])}: dataset name "${dataset.name}" already used by ${prior}`);
    datasetOwner.set(dataset.name, parsed.file);

    dataset.items.forEach((item, i) => {
      const owner = itemOwner.get(item.id);
      const here = `${parsed.file} (${dataset.name})`;
      if (owner) problems.push(`${locate(parsed, ["items", i, "id"])}: duplicate item id "${item.id}" (also in ${owner})`);
      itemOwner.set(item.id, here);
    });
    datasets.push({ file: parsed.file, dataset });
  }
  if (datasetFiles.length === 0) problems.push("datasets/: no dataset files");

  let metrics: Metric[] = [];
  const metricsPath = join(rootDir, "metrics.yaml");
  if (!existsSync(metricsPath)) {
    problems.push("metrics.yaml: missing");
  } else {
    const { parsed, problems: yamlProblems } = parseYaml(metricsPath, rootDir);
    problems.push(...yamlProblems);
    const loaded = parsed ? validate(MetricsFileSchema, parsed, problems) : undefined;
    if (parsed && loaded) {
      const seen = new Set<string>();
      loaded.forEach((m, i) => {
        if (seen.has(m.name)) problems.push(`${locate(parsed, [i, "name"])}: duplicate metric name "${m.name}"`);
        seen.add(m.name);
        if (m.rubric && !existsSync(join(rootDir, m.rubric))) {
          problems.push(`${locate(parsed, [i, "rubric"])}: rubric file not found: ${m.rubric}`);
        }
      });
      metrics = loaded;
    }
  }

  if (problems.length) throw new EvalLoadError(problems);
  return { datasets, metrics };
}
