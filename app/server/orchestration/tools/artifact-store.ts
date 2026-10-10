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
 *   lastAccessedAt, per-session cap with LRU eviction (memory only — the
 *   row stays in SQLite), periodic background cleanup every 60s
 * - Data partitioned by sessionId — cross-session access blocked
 * - Session deletion cascades to the rows
 */

import { appConfig } from "../../config";
import { artifactQueries } from "../../db";
import { logger } from "../../logger";
import { executeJq } from "./jq-engine";

/** Database lifetime, measured from creation. TODO(#30): move to `artifact.db_ttl_hours`. */
const DB_TTL_HOURS = 24;

// Simple ID generator — "art_" + 8 random hex chars
function generateArtifactId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `art_${hex}`;
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

/** The persistence the store needs; the app binds the SQLite queries, tests a test DB. */
export type ArtifactRows = Pick<typeof artifactQueries, "insert" | "findForSession">;

export class ArtifactStore {
  private artifacts = new Map<string, Artifact>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private rows: ArtifactRows) {
    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // Don't hold the process open for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
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
    const id = generateArtifactId();
    const json = JSON.stringify(data);
    const now = Date.now();
    const artifact: Artifact = {
      id,
      sessionId,
      toolName,
      toolInput,
      data,
      rawSizeChars,
      storedSizeChars: json.length,
      createdAt: now,
      expiresAt: now + DB_TTL_HOURS * 3_600_000,
      lastAccessedAt: now,
    };

    try {
      this.rows.insert({
        id,
        session_id: sessionId,
        tool_name: toolName,
        tool_input_json: JSON.stringify(toolInput ?? null),
        data: Buffer.from(Bun.gzipSync(json)),
        raw_size_chars: rawSizeChars,
        stored_size_chars: json.length,
        created_at: Math.floor(artifact.createdAt / 1000),
        expires_at: Math.floor(artifact.expiresAt / 1000),
      });
    } catch (err) {
      // Still usable for this memory window; only the later read-back is lost.
      logger.warn("TOOL", "artifact_persist_failed", {
        error: err instanceof Error ? err : String(err),
        data: { artifact_id: id, tool: toolName },
        ctx: { session_id: sessionId },
      });
    }

    this.warm(artifact);
    return id;
  }

  /**
   * Get an artifact by ID, scoped to the given session.
   * Checks memory first; on a miss loads the row from SQLite and re-warms memory.
   * Returns null if not found or belongs to a different session.
   * Refreshes lastAccessedAt on every access.
   */
  get(id: string, sessionId: string): Artifact | null {
    const cached = this.artifacts.get(id);
    if (cached) {
      if (cached.sessionId !== sessionId) return null;
      cached.lastAccessedAt = Date.now();
      return cached;
    }

    const row = this.rows.findForSession(id, sessionId);
    if (!row) return null;

    // TODO(#30): rows past expires_at return a refresh-guidance error instead.
    const artifact: Artifact = {
      id: row.id,
      sessionId: row.session_id,
      toolName: row.tool_name,
      toolInput: JSON.parse(row.tool_input_json),
      data: JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(row.data)))),
      rawSizeChars: row.raw_size_chars,
      storedSizeChars: row.stored_size_chars,
      createdAt: row.created_at * 1000,
      expiresAt: row.expires_at * 1000,
      lastAccessedAt: Date.now(),
    };
    this.warm(artifact);
    return artifact;
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
    const artifact = this.get(id, sessionId);
    if (!artifact) {
      return {
        result: null,
        error: `Artifact "${id}" not found in this session. Use the artifact_id shown in the tool result preview.`,
      };
    }

    return executeJq(artifact.data, jqFilter);
  }

  /** Whether an artifact's parsed data is currently held in memory. */
  isCached(id: string): boolean {
    return this.artifacts.has(id);
  }

  /**
   * Count in-memory artifacts belonging to a session.
   */
  getSessionCount(sessionId: string): number {
    let count = 0;
    for (const artifact of this.artifacts.values()) {
      if (artifact.sessionId === sessionId) count++;
    }
    return count;
  }

  /**
   * Evict expired artifacts from memory based on lastAccessedAt TTL.
   * Rows stay in SQLite.
   */
  cleanup(): void {
    const ttlMs = appConfig.artifact.ttl_minutes * 60_000;
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, artifact] of this.artifacts) {
      if (now - artifact.lastAccessedAt > ttlMs) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      this.artifacts.delete(id);
    }
  }

  /**
   * Put an artifact in memory, enforcing the per-session cap by evicting
   * the least-recently-accessed one (memory only).
   * TODO(#31): replaced by a `max_session_bytes` budget.
   */
  private warm(artifact: Artifact): void {
    if (this.getSessionCount(artifact.sessionId) >= appConfig.artifact.max_per_session) {
      this.evictOldestInSession(artifact.sessionId);
    }
    this.artifacts.set(artifact.id, artifact);
  }

  /**
   * Evict the least-recently-accessed artifact in a session from memory.
   */
  private evictOldestInSession(sessionId: string): void {
    let oldest: Artifact | null = null;

    for (const artifact of this.artifacts.values()) {
      if (artifact.sessionId !== sessionId) continue;
      if (!oldest || artifact.lastAccessedAt < oldest.lastAccessedAt) {
        oldest = artifact;
      }
    }

    if (oldest) {
      this.artifacts.delete(oldest.id);
    }
  }

  /** For testing: clear the memory cache */
  clear(): void {
    this.artifacts.clear();
  }

  /** For testing: stop cleanup timer */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

/** Process-level singleton */
export const artifactStore = new ArtifactStore(artifactQueries);
