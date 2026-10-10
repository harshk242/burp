/**
 * Artifact Store: SQLite with an in-memory read-through cache
 * (process-level singleton)
 *
 * Stores large, noise-reduced JSON tool outputs so the LLM can
 * query them via the inspect_artifact tool using jq filters.
 *
 * Design:
 * - Process-level singleton, NOT per-request
 * - Every artifact is written to the `artifacts` table (gzipped JSON), so
 *   IDs in replayed history stay readable after the memory copy is gone
 * - Memory holds parsed data for recently used artifacts: TTL based on
 *   lastAccessedAt, periodic background cleanup every 60s
 * - Per-session size budget (`max_session_bytes`) instead of a count cap, so
 *   references from replayed history stay valid: when a store pushes the
 *   session's rows over budget, the oldest by creation are deleted (rows and
 *   memory copies), never the one just stored
 * - Database expiry (`db_ttl_hours`) is measured from creation, not access:
 *   an expired artifact returns refresh guidance (tool + input to re-run),
 *   and an hourly sweep deletes expired rows
 * - Data partitioned by sessionId — cross-session access blocked
 * - Session deletion cascades to the rows
 */

import { appConfig } from "../../config";
import { artifactQueries } from "../../db";
import { logger } from "../../logger";
import { executeJq } from "./jq-engine";

const MEMORY_CLEANUP_INTERVAL_MS = 60_000;
const DB_SWEEP_INTERVAL_MS = 3_600_000;

// Simple ID generator — "art_" + 8 random hex chars
function generateArtifactId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `art_${hex}`;
}

const MAX_ID_ATTEMPTS = 5;

/** SQLite primary-key violation, raw or wrapped by Drizzle (`cause`). */
function isPrimaryKeyConflict(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === "SQLITE_CONSTRAINT_PRIMARYKEY") return true;
  }
  return false;
}

export interface Artifact {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: unknown; // arguments of the tool call that produced the data
  data: unknown; // parsed JSON (noise-reduced)
  rawSizeChars: number; // original size before noise reduction
  storedSizeChars: number; // size after noise reduction
  createdAt: number; // ms
  expiresAt: number; // ms, measured from createdAt
  lastAccessedAt: number; // ms, memory TTL only
}

/** Enough of an expired artifact to tell the model how to refetch it. */
export type ExpiredArtifact = Pick<Artifact, "id" | "toolName" | "toolInput" | "createdAt">;

export type ArtifactLookup =
  | { status: "ok"; artifact: Artifact }
  | { status: "expired"; artifact: ExpiredArtifact }
  | { status: "missing" };

/** The persistence the store needs; the app binds the SQLite queries, tests a test DB. */
export type ArtifactRows = Pick<
  typeof artifactQueries,
  "insert" | "findForSession" | "deleteExpired" | "evictOverBudget"
>;

/** "26h" / "45m": how long ago an artifact was fetched. */
function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

export function expiredArtifactMessage(artifact: ExpiredArtifact, now = Date.now()): string {
  return (
    `Artifact ${artifact.id} expired (fetched ${formatAge(now - artifact.createdAt)} ago). ` +
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
    // Don't hold the process open for cleanup
    for (const timer of this.timers) timer.unref?.();
  }

  /**
   * Store a noise-reduced JSON artifact: write the row, then warm memory.
   */
  store(
    sessionId: string,
    toolName: string,
    toolInput: unknown,
    data: unknown,
    rawSizeChars: number,
  ): string {
    const json = JSON.stringify(data);
    const gzipped = Buffer.from(Bun.gzipSync(json));
    const now = Date.now();
    const expiresAt = now + appConfig.artifact.db_ttl_hours * 3_600_000;

    // IDs are short (32 bits) to keep previews cheap, so a collision with a
    // live row is possible: draw a fresh ID rather than shadow the stored one.
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
          raw_size_chars: rawSizeChars,
          stored_size_chars: json.length,
          created_at: Math.floor(now / 1000),
          expires_at: Math.floor(expiresAt / 1000),
        });
        persisted = true;
        break;
      } catch (err) {
        if (isPrimaryKeyConflict(err) && attempt < MAX_ID_ATTEMPTS) {
          id = generateArtifactId();
          continue;
        }
        // Still usable for this memory window; only the later read-back is lost.
        logger.warn("TOOL", "artifact_persist_failed", {
          error: err instanceof Error ? err : String(err),
          data: { artifact_id: id, tool: toolName },
          ctx: { session_id: sessionId },
        });
        break;
      }
    }
    // A memory-only artifact must not replace another cached artifact either.
    while (!persisted && this.artifacts.has(id)) id = generateArtifactId();

    const artifact: Artifact = {
      id,
      sessionId,
      toolName,
      toolInput,
      data,
      rawSizeChars,
      storedSizeChars: json.length,
      createdAt: now,
      expiresAt,
      lastAccessedAt: now,
    };

    this.artifacts.set(id, artifact);
    if (persisted) this.enforceSessionBudget(sessionId, id);
    return id;
  }

  /**
   * Delete the session's oldest rows (and their memory copies) while its total
   * exceeds `max_session_bytes`, keeping `keepId`. Size is the noise-reduced JSON
   * char count (`stored_size_chars`, pre-gzip): a close-enough proxy for bytes
   * that also bounds the parsed data held in memory. Failures are logged; the
   * tool call still succeeds.
   */
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

  /**
   * Get an artifact by ID, scoped to the given session.
   * Checks memory first; on a miss loads the row from SQLite and re-warms memory.
   * "missing" if not found or it belongs to a different session; "expired" once
   * past expiresAt, wherever it was found. Refreshes lastAccessedAt on every hit.
   */
  get(id: string, sessionId: string): ArtifactLookup {
    const now = Date.now();
    const cached = this.artifacts.get(id);
    if (cached) {
      if (cached.sessionId !== sessionId) return { status: "missing" };
      if (now >= cached.expiresAt) {
        this.artifacts.delete(id);
        return { status: "expired", artifact: cached };
      }
      cached.lastAccessedAt = now;
      return { status: "ok", artifact: cached };
    }

    const row = this.rows.findForSession(id, sessionId);
    if (!row) return { status: "missing" };

    const toolInput: unknown = JSON.parse(row.tool_input_json);
    if (now >= row.expires_at * 1000) {
      return {
        status: "expired",
        artifact: { id: row.id, toolName: row.tool_name, toolInput, createdAt: row.created_at * 1000 },
      };
    }

    const artifact: Artifact = {
      id: row.id,
      sessionId: row.session_id,
      toolName: row.tool_name,
      toolInput,
      data: JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(row.data)))),
      rawSizeChars: row.raw_size_chars,
      storedSizeChars: row.stored_size_chars,
      createdAt: row.created_at * 1000,
      expiresAt: row.expires_at * 1000,
      lastAccessedAt: now,
    };
    this.artifacts.set(artifact.id, artifact);
    return { status: "ok", artifact };
  }

  /**
   * Execute a jq filter against a stored artifact.
   * Session-scoped: only works if the artifact belongs to the requesting session.
   */
  async query(
    id: string,
    sessionId: string,
    jqFilter: string,
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

    return executeJq(lookup.artifact.data, jqFilter);
  }

  /** Whether an artifact's parsed data is currently held in memory. */
  isCached(id: string): boolean {
    return this.artifacts.has(id);
  }

  /**
   * Evict expired artifacts from memory based on lastAccessedAt TTL
   * (or past their database expiry). Rows stay in SQLite.
   */
  cleanup(): void {
    const ttlMs = appConfig.artifact.ttl_minutes * 60_000;
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, artifact] of this.artifacts) {
      if (now - artifact.lastAccessedAt > ttlMs || now >= artifact.expiresAt) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      this.artifacts.delete(id);
    }
  }

  /**
   * Delete rows past their database expiry. Runs hourly; returns rows removed.
   */
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

  /** For testing: clear the memory cache */
  clear(): void {
    this.artifacts.clear();
  }

  /** For testing: stop cleanup timers */
  destroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}

/** Process-level singleton */
export const artifactStore = new ArtifactStore(artifactQueries);
