import { z } from "zod";

export interface ScoreConfigCategory {
  label: string;
  value: number;
}

export interface ScoreConfigBody {
  name: string;
  dataType: "NUMERIC" | "BOOLEAN" | "CATEGORICAL";
  description?: string | undefined;
  minValue?: number | undefined;
  maxValue?: number | undefined;
  categories?: ScoreConfigCategory[] | undefined;
}

export interface RemoteScoreConfig extends ScoreConfigBody {
  id: string;
  isArchived: boolean;
}

export interface DatasetBody {
  name: string;
  description?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
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

/** An optional response field; Langfuse sends `null` for unset ones, read as absent. */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((value): z.infer<T> | undefined => value ?? undefined);
}

// Response schemas: `passthrough` keeps the fields these do not list, as the SDK objects are passed on as is.
const RemoteScoreConfigSchema = z
  .object({
    id: z.string(),
    isArchived: z.boolean(),
    name: z.string(),
    dataType: z.enum(["NUMERIC", "BOOLEAN", "CATEGORICAL"]),
    description: optional(z.string()),
    minValue: optional(z.number()),
    maxValue: optional(z.number()),
    categories: optional(z.array(z.object({ label: z.string(), value: z.number() }))),
  })
  .passthrough() satisfies z.ZodType<RemoteScoreConfig, z.ZodTypeDef, unknown>;

const RemoteDatasetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: optional(z.string()),
    metadata: optional(z.record(z.unknown())),
  })
  .passthrough() satisfies z.ZodType<RemoteDataset, z.ZodTypeDef, unknown>;

const RemoteDatasetItemSchema = z
  .object({
    id: z.string(),
    datasetName: z.string(),
    input: z.unknown(),
    expectedOutput: z.unknown(),
    metadata: z.record(z.unknown()).nullish().transform((value) => value ?? null),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
  })
  .passthrough()
  // zod marks `unknown` fields optional; the item always carries them (possibly `null`).
  .transform((item) => ({ ...item, input: item.input, expectedOutput: item.expectedOutput })) satisfies z.ZodType<
  RemoteDatasetItem,
  z.ZodTypeDef,
  unknown
>;

export interface LangfuseApi {
  listScoreConfigs(): Promise<RemoteScoreConfig[]>;
  createScoreConfig(body: ScoreConfigBody): Promise<RemoteScoreConfig>;
  getDataset(name: string): Promise<RemoteDataset | null>;
  upsertDataset(body: DatasetBody): Promise<RemoteDataset>;
  listItems(datasetName: string): Promise<RemoteDatasetItem[]>;
  getItem(id: string): Promise<RemoteDatasetItem | null>;
  upsertItem(body: DatasetItemBody): Promise<RemoteDatasetItem>;
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

/** A response schema producing `T` from the parsed JSON. */
type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

/** `request`'s result for a 404 when the caller accepts one. */
const NOT_FOUND = Symbol("not found");

function parseResponse<T>(schema: Schema<T>, json: unknown, method: string, path: string): T {
  const parsed = schema.safeParse(json);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(body)"} ${i.message}`).join("; ");
  throw new Error(`Langfuse ${method} ${path}: unexpected response shape: ${issues}`);
}

export function createLangfuseApi(opts: LangfuseApiOptions): LangfuseApi {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${opts.publicKey}:${opts.secretKey}`).toString("base64")}`;
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  async function request(method: string, path: string, body?: unknown, allow404 = false): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { Authorization: auth, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (allow404 && res.status === 404) return NOT_FOUND;
    const text = await res.text();
    if (!res.ok) throw new LangfuseApiError(res.status, method, path, text);
    return text ? JSON.parse(text) : null;
  }

  async function fetchOne<T>(schema: Schema<T>, method: string, path: string, body?: unknown): Promise<T> {
    return parseResponse(schema, await request(method, path, body), method, path);
  }

  async function fetchOptional<T>(schema: Schema<T>, path: string): Promise<T | null> {
    const json = await request("GET", path, undefined, true);
    return json === NOT_FOUND ? null : parseResponse(schema, json, "GET", path);
  }

  async function paginate<T>(schema: Schema<T>, path: string, query: Record<string, string> = {}): Promise<T[]> {
    const pageSchema = z.object({ data: z.array(schema), meta: z.object({ totalPages: z.number() }).passthrough() });
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const qs = new URLSearchParams({ ...query, page: String(page), limit: String(PAGE_LIMIT) });
      const res = await fetchOne(pageSchema, "GET", `${path}?${qs}`);
      out.push(...res.data);
      if (page >= res.meta.totalPages || res.data.length === 0) return out;
    }
  }

  const enc = encodeURIComponent;
  return {
    listScoreConfigs: () => paginate(RemoteScoreConfigSchema, "/api/public/score-configs"),
    createScoreConfig: (body) => fetchOne(RemoteScoreConfigSchema, "POST", "/api/public/score-configs", body),
    getDataset: (name) => fetchOptional(RemoteDatasetSchema, `/api/public/v2/datasets/${enc(name)}`),
    upsertDataset: (body) => fetchOne(RemoteDatasetSchema, "POST", "/api/public/v2/datasets", body),
    listItems: (datasetName) => paginate(RemoteDatasetItemSchema, "/api/public/dataset-items", { datasetName }),
    getItem: (id) => fetchOptional(RemoteDatasetItemSchema, `/api/public/dataset-items/${enc(id)}`),
    upsertItem: (body) => fetchOne(RemoteDatasetItemSchema, "POST", "/api/public/dataset-items", body),
    deleteItem: async (id) => {
      await request("DELETE", `/api/public/dataset-items/${enc(id)}`, undefined, true);
    },
  };
}

export function langfuseApiFromEnv(env: Record<string, string | undefined> = process.env): LangfuseApi {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  const baseUrl = env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
  if (!publicKey || !secretKey) {
    throw new Error("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set (app/.env)");
  }
  return createLangfuseApi({ baseUrl, publicKey, secretKey });
}
