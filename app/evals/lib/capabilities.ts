import type { ArmSpec } from "./arms";

export interface ModelInfo {
  id: string;
  display_name?: string;
  max_input_tokens?: number;
  max_tokens?: number;
  capabilities?: {
    effort?: { supported?: boolean } & Record<string, { supported?: boolean } | boolean | undefined>;
    thinking?: { types?: { adaptive?: { supported?: boolean } } };
  };
}

export interface ModelsApiOptions {
  apiKey: string | undefined;
  /** Same convention as the chat provider's ANTHROPIC_BASE_URL: includes `/v1`. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

export class CapabilityError extends Error {
  constructor(readonly problems: string[]) {
    super(`arm capability check failed:\n  ${problems.join("\n  ")}`);
    this.name = "CapabilityError";
  }
}

/** One model's info, or a problem line. */
export async function fetchModelInfo(id: string, opts: ModelsApiOptions): Promise<ModelInfo | string> {
  const base = (opts.baseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, "");
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(`${base}/models/${encodeURIComponent(id)}`, {
      headers: { "x-api-key": opts.apiKey ?? "", "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return `${id}: Models API request failed (${error instanceof Error ? error.message : String(error)})`;
  }
  if (res.status === 404) return `${id}: unknown model (Models API 404)`;
  if (!res.ok) return `${id}: Models API returned ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
  return (await res.json()) as ModelInfo;
}

/** Problems of one arm against its model's info (empty = ok). */
export function armProblems(arm: ArmSpec, info: ModelInfo, maxContextTokens: number): string[] {
  const where = `${arm.model}:${arm.effort}`;
  const caps = info.capabilities ?? {};
  const problems: string[] = [];
  if (caps.thinking?.types?.adaptive?.supported !== true) problems.push(`${where}: model does not support adaptive thinking`);
  const level = caps.effort?.[arm.effort];
  if (caps.effort?.supported !== true) problems.push(`${where}: model does not support effort`);
  else if (typeof level !== "object" || level?.supported !== true) problems.push(`${where}: model does not support effort level "${arm.effort}"`);
  if (info.max_input_tokens !== undefined && info.max_input_tokens < maxContextTokens) {
    problems.push(`${where}: context window ${info.max_input_tokens} is below max_context_tokens ${maxContextTokens}`);
  }
  if (arm.max_output_tokens !== undefined && info.max_tokens !== undefined && arm.max_output_tokens > info.max_tokens) {
    problems.push(`${where}: max_output_tokens ${arm.max_output_tokens} exceeds the model's limit ${info.max_tokens}`);
  }
  return problems;
}

/** Checks every arm (one request per distinct model). Returns model infos by id; throws CapabilityError listing all problems. */
export async function checkCapabilities(arms: ArmSpec[], maxContextTokens: number, opts: ModelsApiOptions): Promise<Map<string, ModelInfo>> {
  if (!opts.apiKey) throw new CapabilityError(["ANTHROPIC_API_KEY is not set (needed for the Models API check and the run)"]);
  const models = [...new Set(arms.map((a) => a.model))];
  const fetched = await Promise.all(models.map(async (id) => [id, await fetchModelInfo(id, opts)] as const));
  const problems: string[] = [];
  const infos = new Map<string, ModelInfo>();
  for (const [id, info] of fetched) {
    if (typeof info === "string") problems.push(info);
    else infos.set(id, info);
  }
  for (const arm of arms) {
    const info = infos.get(arm.model);
    if (info) problems.push(...armProblems(arm, info, maxContextTokens));
  }
  if (problems.length) throw new CapabilityError(problems);
  return infos;
}
