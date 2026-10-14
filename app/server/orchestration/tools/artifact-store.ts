import { appConfig } from "../../config";
import { artifactQueries } from "../../db";
import { logger } from "../../logger";
import { executeJq } from "./jq-engine";

const MEMORY_CLEANUP_INTERVAL_MS = 60_000;
const DB_SWEEP_INTERVAL_MS = 3_600_000;

function generateArtifactId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `art_${hex}`;
}

const MAX_ID_ATTEMPTS = 5;

function isPrimaryKeyConflict(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === "SQLITE_CONSTRAINT_PRIMARYKEY") return true;
  }
  return false;
}

export const MAX_TEXT_RANGE_CHARS = 16_000;

export interface Artifact {
  type: "json" | "text";
  storedSizeBytes: number;
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  data: unknown;
  rawSizeChars: number;
  storedSizeChars: number;
  createdAtMs: number;
  expiresAtMs: number;
  lastAccessedAtMs: number;
}

export type ExpiredArtifact = Pick<Artifact, "id" | "toolName" | "toolInput" | "createdAtMs">;

export type ArtifactLookup =
  | { status: "ok"; artifact: Artifact }
  | { status: "expired"; artifact: ExpiredArtifact }
  | { status: "missing" };

export type ArtifactRows = Pick<
  typeof artifactQueries,
  "insert" | "findForSession" | "deleteExpired" | "evictOverBudget"
>;

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

export function expiredArtifactMessage(artifact: ExpiredArtifact, now = Date.now()): string {
  return (
    `Artifact ${artifact.id} expired (fetched ${formatAge(now - artifact.createdAtMs)} ago). ` +
    `Re-run \`${artifact.toolName}\` with ${JSON.stringify(artifact.toolInput ?? {})} for current data.`
  );
}

export class ArtifactStore {
  private artifacts = new Map<string, Artifact>();
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private rows: ArtifactRows) {
    this.timers.push(
      setInterval(() => this.cleanup(), MEMORY_CLEANUP_INTERVAL_MS),
      setInterval(() => this.sweepExpired(), DB_SWEEP_INTERVAL_MS),
    );
    for (const timer of this.timers) timer.unref?.();
  }

  store(
    sessionId: string,
    toolName: string,
    toolInput: unknown,
    data: unknown,
    rawSizeChars: number,
    type: "json" | "text" = "json",
  ): string {
    if (type === "text" && typeof data !== "string") throw new Error("Text artifacts require string data");
    const json = type === "text" ? data as string : JSON.stringify(data);
    const uncompressedUtf8Bytes = Buffer.byteLength(json, "utf8");
    const gzipped = Buffer.from(Bun.gzipSync(json));
    const now = Date.now();
    const expiresAtMs = now + appConfig.artifact.db_ttl_hours * 3_600_000;

    let id = generateArtifactId();
    let persisted = false;
    for (let attempt = 1; ; attempt++) {
      try {
        this.rows.insert({
          id,
          session_id: sessionId,
          tool_name: toolName,
          tool_input_json: JSON.stringify(toolInput ?? null),
          data: gzipped,
          artifact_type: type,
          stored_size_bytes: uncompressedUtf8Bytes,
          raw_size_chars: rawSizeChars,
          stored_size_chars: json.length,
          created_at: Math.floor(now / 1000),
          expires_at: Math.floor(expiresAtMs / 1000),
        });
        persisted = true;
        break;
      } catch (err) {
        if (isPrimaryKeyConflict(err) && attempt < MAX_ID_ATTEMPTS) {
          id = generateArtifactId();
          continue;
        }
        logger.warn("TOOL", "artifact_persist_failed", {
          error: err instanceof Error ? err : String(err),
          data: { artifact_id: id, tool: toolName },
          ctx: { session_id: sessionId },
        });
        break;
      }
    }
    while (!persisted && this.artifacts.has(id)) id = generateArtifactId();

    const artifact: Artifact = {
      type,
      storedSizeBytes: uncompressedUtf8Bytes,
      id,
      sessionId,
      toolName,
      toolInput,
      data,
      rawSizeChars,
      storedSizeChars: json.length,
      createdAtMs: now,
      expiresAtMs,
      lastAccessedAtMs: now,
    };

    this.artifacts.set(id, artifact);
    if (persisted) this.enforceSessionBudget(sessionId, id);
    return id;
  }

  private enforceSessionBudget(sessionId: string, keepId: string): void {
    try {
      const evicted = this.rows.evictOverBudget(
        sessionId,
        appConfig.artifact.max_session_bytes,
        keepId,
      );
      if (evicted.length === 0) return;
      for (const id of evicted) this.artifacts.delete(id);
      logger.info("TOOL", "artifact_budget_evicted", {
        data: { evicted },
        ctx: { session_id: sessionId },
      });
    } catch (err) {
      logger.warn("TOOL", "artifact_budget_evict_failed", {
        error: err instanceof Error ? err : String(err),
        data: { artifact_id: keepId },
        ctx: { session_id: sessionId },
      });
    }
  }

  get(id: string, sessionId: string): ArtifactLookup {
    const now = Date.now();
    const cached = this.artifacts.get(id);
    if (cached) {
      if (cached.sessionId !== sessionId) return { status: "missing" };
      if (now >= cached.expiresAtMs) {
        this.artifacts.delete(id);
        return { status: "expired", artifact: cached };
      }
      cached.lastAccessedAtMs = now;
      return { status: "ok", artifact: cached };
    }

    const row = this.rows.findForSession(id, sessionId);
    if (!row) return { status: "missing" };

    const toolInput: unknown = JSON.parse(row.tool_input_json);
    if (now >= row.expires_at * 1000) {
      return {
        status: "expired",
        artifact: { id: row.id, toolName: row.tool_name, toolInput, createdAtMs: row.created_at * 1000 },
      };
    }

    const artifact: Artifact = {
      type: row.artifact_type,
      storedSizeBytes: row.stored_size_bytes,
      id: row.id,
      sessionId: row.session_id,
      toolName: row.tool_name,
      toolInput,
      data: this.decode(row.data, row.artifact_type),
      rawSizeChars: row.raw_size_chars,
      storedSizeChars: row.stored_size_chars,
      createdAtMs: row.created_at * 1000,
      expiresAtMs: row.expires_at * 1000,
      lastAccessedAtMs: now,
    };
    this.artifacts.set(artifact.id, artifact);
    return { status: "ok", artifact };
  }

  async query(
    id: string,
    sessionId: string,
    jqFilter: string,
    signal?: AbortSignal,
  ): Promise<{ result: unknown; truncated?: boolean; error?: string }> {
    const lookup = this.get(id, sessionId);
    if (lookup.status === "missing") {
      return {
        result: null,
        error: `Artifact "${id}" not found in this session. Use the artifact_id shown in the tool result preview.`,
      };
    }
    if (lookup.status === "expired") {
      return { result: null, error: expiredArtifactMessage(lookup.artifact) };
    }

    if (lookup.artifact.type !== "json") {
      return { result: null, error: "Text artifacts require text_range inspection instead of jq_filter." };
    }
    return executeJq(lookup.artifact.data, jqFilter, { signal });
  }

  private decode(data: Buffer, type: "json" | "text"): unknown {
    const text = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(data)));
    return type === "text" ? text : JSON.parse(text);
  }

  readText(id: string, sessionId: string, start: number, length: number) {
    const lookup = this.get(id, sessionId);
    if (lookup.status === "missing") return { error: "Artifact not found in this session." };
    if (lookup.status === "expired") return { error: expiredArtifactMessage(lookup.artifact) };
    if (lookup.artifact.type !== "text") return { error: "JSON artifacts require jq_filter inspection." };
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1 || length > MAX_TEXT_RANGE_CHARS) {
      return { error: "text_range requires a nonnegative start and length between 1 and " + MAX_TEXT_RANGE_CHARS + " UTF-16 code units." };
    }
    const text = lookup.artifact.data as string;
    const end = Math.min(start + length, text.length);
    if (start > text.length) return { error: "text_range start exceeds the artifact length." };
    return { text: text.slice(start, end), start, end, total_chars: text.length, next_start: end < text.length ? end : null };
  }

  isCached(id: string): boolean {
    return this.artifacts.has(id);
  }

  cleanup(): void {
    const ttlMs = appConfig.artifact.ttl_minutes * 60_000;
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, artifact] of this.artifacts) {
      if (now - artifact.lastAccessedAtMs > ttlMs || now >= artifact.expiresAtMs) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      this.artifacts.delete(id);
    }
  }

  sweepExpired(now = Date.now()): number {
    try {
      const removed = this.rows.deleteExpired(Math.floor(now / 1000));
      if (removed > 0) {
        logger.info("TOOL", "artifact_sweep", { data: { removed } });
      }
      return removed;
    } catch (err) {
      logger.warn("TOOL", "artifact_sweep_failed", {
        error: err instanceof Error ? err : String(err),
      });
      return 0;
    }
  }

  clear(): void {
    this.artifacts.clear();
  }

  destroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}

export const artifactStore = new ArtifactStore(artifactQueries);
