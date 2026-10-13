/**
 * Minimal Langfuse public-API client for eval sync: plain fetch, Basic auth.
 *
 * Field names checked against `bunx langfuse-cli api schema --json` (API snapshot 4.35.0,
 * 2026-10-11):
 * - POST /api/public/score-configs     { name, dataType, categories?[{label,value}], minValue?, maxValue?, description? }
 * - GET  /api/public/score-configs     paginated (page, limit)
 * - POST /api/public/v2/datasets       { name, description?, metadata? }
 * - GET  /api/public/v2/datasets/{name}
 * - POST /api/public/dataset-items     { id, datasetName, input?, expectedOutput?, metadata?, status? }; upsert by id,
 *                                      ids are unique project-wide; status ACTIVE | ARCHIVED
 * - GET  /api/public/dataset-items     paginated, filter datasetName
 * - GET  /api/public/dataset-items/{id}
 * Nothing here deletes: removed items are archived, configs are never edited.
 */

export interface ScoreConfigCategory {
  label: string;
  value: number;
}

export interface ScoreConfigBody {
  name: string;
  dataType: "NUMERIC" | "BOOLEAN" | "CATEGORICAL";
  description?: string;
  minValue?: number;
  maxValue?: number;
  categories?: ScoreConfigCategory[];
}

export interface RemoteScoreConfig extends ScoreConfigBody {
  id: string;
  isArchived: boolean;
}

export interface DatasetBody {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export type RemoteDataset = DatasetBody & { id: string };

export type ItemStatus = "ACTIVE" | "ARCHIVED";

export interface DatasetItemBody {
  id: string;
  datasetName: string;
  input: unknown;
  expectedOutput: unknown;
  metadata: Record<string, unknown> | null;
  status: ItemStatus;
}

export type RemoteDatasetItem = DatasetItemBody;

export interface LangfuseApi {
  listScoreConfigs(): Promise<RemoteScoreConfig[]>;
  createScoreConfig(body: ScoreConfigBody): Promise<RemoteScoreConfig>;
  getDataset(name: string): Promise<RemoteDataset | null>;
  upsertDataset(body: DatasetBody): Promise<RemoteDataset>;
  listItems(datasetName: string): Promise<RemoteDatasetItem[]>;
  getItem(id: string): Promise<RemoteDatasetItem | null>;
  upsertItem(body: DatasetItemBody): Promise<RemoteDatasetItem>;
  /** Hard delete; only the round-trip test uses it. Sync archives, never deletes. */
  deleteItem(id: string): Promise<void>;
}

export interface LangfuseApiOptions {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class LangfuseApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    body: string,
  ) {
    super(`Langfuse ${method} ${path} → ${status}: ${body.slice(0, 500)}`);
    this.name = "LangfuseApiError";
  }
}

const PAGE_LIMIT = 100;

export function createLangfuseApi(opts: LangfuseApiOptions): LangfuseApi {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${opts.publicKey}:${opts.secretKey}`).toString("base64")}`;
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T>;
  async function request<T>(method: string, path: string, body: unknown, allow404: true): Promise<T | null>;
  async function request<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | null> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { Authorization: auth, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (allow404 && res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new LangfuseApiError(res.status, method, path, text);
    return (text ? JSON.parse(text) : null) as T;
  }

  async function paginate<T>(path: string, query: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const qs = new URLSearchParams({ ...query, page: String(page), limit: String(PAGE_LIMIT) });
      const res = await request<{ data: T[]; meta: { totalPages: number } }>("GET", `${path}?${qs}`);
      out.push(...res.data);
      if (page >= res.meta.totalPages || res.data.length === 0) return out;
    }
  }

  const enc = encodeURIComponent;
  return {
    listScoreConfigs: () => paginate<RemoteScoreConfig>("/api/public/score-configs"),
    createScoreConfig: (body) => request<RemoteScoreConfig>("POST", "/api/public/score-configs", body),
    getDataset: (name) => request<RemoteDataset>("GET", `/api/public/v2/datasets/${enc(name)}`, undefined, true),
    upsertDataset: (body) => request<RemoteDataset>("POST", "/api/public/v2/datasets", body),
    listItems: (datasetName) => paginate<RemoteDatasetItem>("/api/public/dataset-items", { datasetName }),
    getItem: (id) => request<RemoteDatasetItem>("GET", `/api/public/dataset-items/${enc(id)}`, undefined, true),
    upsertItem: (body) => request<RemoteDatasetItem>("POST", "/api/public/dataset-items", body),
    deleteItem: async (id) => {
      await request("DELETE", `/api/public/dataset-items/${enc(id)}`, undefined, true);
    },
  };
}

/** Reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL (app/.env). */
export function langfuseApiFromEnv(env: Record<string, string | undefined> = process.env): LangfuseApi {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  const baseUrl = env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
  if (!publicKey || !secretKey) {
    throw new Error("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set (app/.env)");
  }
  return createLangfuseApi({ baseUrl, publicKey, secretKey });
}
