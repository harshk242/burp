/**
 * ScoreWriter: acknowledged score writes for feedback sync, as plain `fetch`
 * calls to the public API (Basic auth from the Langfuse keys, 10 s timeout).
 *
 * Not the SDK: `score.create` only queues the event and its flush swallows
 * errors, and the SDK exposes score delete only under the deprecated
 * `api.legacy.scoreV1` namespace. These endpoints are the public contract:
 * - upsert: POST /api/public/scores (upsert by id)
 * - remove: DELETE /api/public/scores/{id} (404 counts as success)
 * - exists: GET /api/public/v3/scores?id= (the v4 org rejects legacy reads)
 *
 * Every call resolves only on a 2xx; anything else (network, non-2xx,
 * timeout) rejects.
 */

type Env = Record<string, string | undefined>;

export interface ScoreUpsert {
  id: string;
  traceId: string;
  name: string;
  value: number;
  dataType: "NUMERIC" | "BOOLEAN" | "CATEGORICAL";
  environment: string;
  comment?: string | null;
  configId?: string;
  metadata?: Record<string, unknown>;
}

export interface ScoreWriter {
  upsert(body: ScoreUpsert): Promise<void>;
  remove(id: string): Promise<void>;
  /** Whether Langfuse currently returns the score (reads lag acknowledged writes). */
  exists(id: string): Promise<boolean>;
}

export const SCORE_WRITE_TIMEOUT_MS = 10_000;

export class ScoreWriteError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ScoreWriteError";
  }
}

export interface ScoreWriterOptions {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createScoreWriter(options: ScoreWriterOptions): ScoreWriter {
  const base = options.baseUrl.replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${options.publicKey}:${options.secretKey}`).toString("base64")}`;
  const timeoutMs = options.timeoutMs ?? SCORE_WRITE_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;

  async function call(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<Response> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { Authorization: auth, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      const text = await res.text().catch(() => "");
      throw new ScoreWriteError(`${method} ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`, res.status);
    }
    return res;
  }

  return {
    async upsert(body) {
      await call("POST", "/api/public/scores", body);
    },
    async remove(id) {
      await call("DELETE", `/api/public/scores/${encodeURIComponent(id)}`, undefined, [404]);
    },
    async exists(id) {
      const res = await call("GET", `/api/public/v3/scores?id=${encodeURIComponent(id)}&limit=1`);
      const json = (await res.json()) as { data?: unknown[] };
      return Array.isArray(json.data) && json.data.length > 0;
    },
  };
}

/** The writer for the configured Langfuse project; null without keys. */
export function scoreWriterFromEnv(env: Env = process.env): ScoreWriter | null {
  const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = env;
  if (!publicKey || !secretKey) return null;
  const baseUrl = env.LANGFUSE_BASE_URL || env.LANGFUSE_BASEURL || "https://cloud.langfuse.com";
  return createScoreWriter({ baseUrl, publicKey, secretKey });
}
