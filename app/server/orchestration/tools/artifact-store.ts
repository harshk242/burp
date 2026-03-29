/**
 * In-Memory Artifact Store (process-level singleton)
 *
 * Stores large, noise-reduced JSON tool outputs so the LLM can
 * query them via the inspect_artifact tool using jq filters.
 *
 * Design:
 * - Process-level singleton, NOT per-request
 * - Data partitioned by sessionId — cross-session access blocked
 * - TTL based on lastAccessedAt so actively used artifacts survive
 * - Per-session cap with LRU eviction
 * - Periodic background cleanup every 60s
 */

import { appConfig } from "../../config";
import { executeJq } from "./jq-engine";

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
  data: unknown; // parsed JSON (noise-reduced)
  rawSizeChars: number; // original size before noise reduction
  storedSizeChars: number; // size after noise reduction
  createdAt: number;
  lastAccessedAt: number;
}

class ArtifactStore {
  private artifacts = new Map<string, Artifact>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // Don't hold the process open for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Store a noise-reduced JSON artifact.
   * Enforces per-session cap by evicting the least-recently-accessed artifact.
   */
  store(
    sessionId: string,
    toolName: string,
    data: unknown,
    rawSizeChars: number,
  ): string {
    const cfg = appConfig.artifact;

    // Enforce per-session cap — evict oldest by lastAccessedAt
    const sessionCount = this.getSessionCount(sessionId);
    if (sessionCount >= cfg.max_per_session) {
      this.evictOldestInSession(sessionId);
    }

    const id = generateArtifactId();
    const storedSizeChars = JSON.stringify(data).length;
    const now = Date.now();

    this.artifacts.set(id, {
      id,
      sessionId,
      toolName,
      data,
      rawSizeChars,
      storedSizeChars,
      createdAt: now,
      lastAccessedAt: now,
    });

    return id;
  }

  /**
   * Get an artifact by ID, scoped to the given session.
   * Returns null if not found or belongs to a different session.
   * Refreshes lastAccessedAt on every access.
   */
  get(id: string, sessionId: string): Artifact | null {
    const artifact = this.artifacts.get(id);
    if (!artifact || artifact.sessionId !== sessionId) return null;

    // Refresh access time
    artifact.lastAccessedAt = Date.now();
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
        error: `Artifact "${id}" not found or expired. The data may have been cleaned up after inactivity.`,
      };
    }

    return executeJq(artifact.data, jqFilter);
  }

  /**
   * Count artifacts belonging to a session.
   */
  getSessionCount(sessionId: string): number {
    let count = 0;
    for (const artifact of this.artifacts.values()) {
      if (artifact.sessionId === sessionId) count++;
    }
    return count;
  }

  /**
   * Evict expired artifacts based on lastAccessedAt TTL.
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
   * Evict the least-recently-accessed artifact in a session.
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

  /** For testing: clear all artifacts */
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
export const artifactStore = new ArtifactStore();
