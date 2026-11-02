import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DB_PATH } from "../db/client";
import { db, chatTurnQueries, dailyUsageQueries, usageEventQueries, type ChatTurnOutcome } from "../db";
import { logger } from "../logger";
import type { DrizzleDb } from "../db";
import type { createQueries } from "../db/queries";
import type { DbUsageEvent } from "../types";

export interface UsageRecoveryJob {
  id: string;
  event?: Omit<DbUsageEvent, "created_at">;
  turnId: string | null;
  outcome?: ChatTurnOutcome;
}

export class UsageRecoveryJournal {
  private jobs: UsageRecoveryJob[];

  constructor(private readonly path: string, private readonly apply: (job: UsageRecoveryJob) => void,
    private readonly recorded: (id: string) => boolean) {
    this.jobs = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  }

  submit(job: UsageRecoveryJob): void {
    if (!this.jobs.some((pending) => pending.id === job.id)) this.jobs.push(job);
    this.flush();
  }

  pendingCost(userId: string, period: string): number {
    return this.jobs.reduce((sum, job) => {
      const event = job.event;
      return event && event.user_id === userId && (event.date === period || event.month === period) && !this.recorded(event.id)
        ? sum + event.cost_microusd : sum;
    }, 0);
  }

  flush(): void {
    if (this.jobs.length === 0) return;
    try {
      this.save();
    } catch (error) {
      this.report(error);
      return;
    }
    for (const job of [...this.jobs]) {
      try {
        this.apply(job);
        this.jobs = this.jobs.filter((pending) => pending.id !== job.id);
        this.save();
      } catch (error) {
        this.report(error);
      }
    }
  }

  private report(error: unknown): void {
    logger.error("CHAT", "usage_reconciliation_pending", {
      error: error instanceof Error ? error : String(error), data: { pending_jobs: this.jobs.length },
    });
  }

  private save(): void {
    const folder = dirname(this.path);
    mkdirSync(folder, { recursive: true });
    const temporary = `${this.path}.next`;
    const file = openSync(temporary, "w", 0o600);
    try { writeFileSync(file, JSON.stringify(this.jobs)); fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, this.path);
    const directory = openSync(folder, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}

const path = (!DB_PATH || DB_PATH === ":memory:")
  ? join(tmpdir(), `usage-recovery-${process.pid}-${crypto.randomUUID()}.json`)
  : `${DB_PATH}.usage-recovery.json`;

type RecoveryQueries = Pick<ReturnType<typeof createQueries>, "usageEventQueries" | "dailyUsageQueries" | "chatTurnQueries">;

function applyRecovery(job: UsageRecoveryJob, database: DrizzleDb, queries: RecoveryQueries): void {
  database.transaction(() => {
    if (job.event && !queries.usageEventQueries.exists(job.event.id)) {
      queries.usageEventQueries.create(job.event);
      queries.dailyUsageQueries.incrementTokens(job.event.user_id, job.event.input_tokens, job.event.output_tokens, job.event.date);
    }
    if (job.turnId && job.outcome) queries.chatTurnQueries.finish(job.turnId, job.outcome);
  });
}

export function createUsageRecovery(path: string, database: DrizzleDb, queries: RecoveryQueries): UsageRecoveryJournal {
  return new UsageRecoveryJournal(path, (job) => applyRecovery(job, database, queries), (id) => queries.usageEventQueries.exists(id));
}

export const usageRecovery = new UsageRecoveryJournal(path,
  (job) => applyRecovery(job, db, { usageEventQueries, dailyUsageQueries, chatTurnQueries }),
  (id) => usageEventQueries.exists(id));

queueMicrotask(() => usageRecovery.flush());
const retry = setInterval(() => usageRecovery.flush(), 1_000);
retry.unref();
