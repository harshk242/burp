import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { createUsageRecovery, UsageRecoveryJournal, type UsageRecoveryJob } from "../orchestration/usage-reconciliation";
import { UsageMeter } from "../orchestration/usage-meter";
import { UserCostBudgetRegistry } from "../orchestration/user-cost-budget";

const path = () => join(mkdtempSync(join(tmpdir(), "usage-recovery-test-")), "journal.json");
const ctx = { user_id: "user", session_id: "session" };
const meter = () => {
  const result = new UsageMeter("anthropic", "claude-sonnet-5-5", ctx);
  result.add({ noCacheTokens: 100, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 10 }, { estimated: true });
  return result;
};
const job = (): UsageRecoveryJob => ({
  id: crypto.randomUUID(), turnId: "turn", outcome: { status: "error", iterations: 1, errorCode: "provider_error" },
  event: {
    id: crypto.randomUUID(), user_id: "user", date: "2000-01-01", month: "2000-01", operation: "chat",
    provider: "anthropic", model: "test", ...meter().ledgerFields(), status: "error", session_id: "session",
    message_id: null, turn_id: "turn", reconciliation_state: "uncertain",
  },
});

function fixture() {
  const t = createTestDb();
  const q = createQueries(t.db);
  q.userQueries.create("user", "clerk", "u@example.com", null, null, "user", null, null);
  q.chatSessionQueries.create("session", "user", null);
  q.messageQueries.create("question", "session", "user", "q", null);
  q.chatTurnQueries.start("turn", "session", "question");
  return { t, q };
}

describe("durable usage reconciliation", () => {
  it("survives a restart, retries ledger/token/finalization atomically, and is idempotent", () => {
    const { t, q } = fixture();
    try {
      const file = path();
      const pending = job();
      t.sqlite.run("CREATE TRIGGER fail_tokens BEFORE INSERT ON daily_usage BEGIN SELECT RAISE(ABORT, 'disk busy'); END");
      const first = createUsageRecovery(file, t.db, q);
      expect(() => first.submit(pending)).not.toThrow();
      expect(q.usageEventQueries.exists(pending.event!.id)).toBe(false);
      expect(q.chatTurnQueries.findById("turn")!.status).toBe("running");
      expect(first.pendingCost("user", "2000-01-01")).toBe(pending.event!.cost_microusd);
      t.sqlite.run("DROP TRIGGER fail_tokens");
      const restarted = createUsageRecovery(file, t.db, q);
      restarted.flush();
      restarted.submit(pending);
      restarted.flush();
      expect(q.usageEventQueries.findByTurnId("turn")).toHaveLength(1);
      expect(q.chatTurnQueries.findById("turn")!.status).toBe("error");
      expect(t.sqlite.query("SELECT date, input_tokens, output_tokens FROM daily_usage").get())
        .toEqual({ date: "2000-01-01", input_tokens: 100, output_tokens: 10 });
      expect(restarted.pendingCost("user", "2000-01")).toBe(0);
      expect(q.usageEventQueries.findPendingReconciliation()).toHaveLength(1);
      const measured = meter();
      measured.add({ noCacheTokens: 50, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 5 });
      expect(q.usageEventQueries.reconcile(pending.event!.id, measured.ledgerFields())).toBe(true);
      expect(q.usageEventQueries.reconcile(pending.event!.id, measured.ledgerFields())).toBe(false);
      expect(q.usageEventQueries.findPendingReconciliation()).toHaveLength(0);
      expect(t.sqlite.query("SELECT input_tokens, output_tokens FROM daily_usage").get()).toEqual({ input_tokens: 150, output_tokens: 15 });
    } finally { t.sqlite.close(); }
  });

  it("enforces caps after an in-flight budget releases while usage is awaiting persistence", () => {
    const pending = job();
    pending.event!.date = new Date().toISOString().slice(0, 10);
    pending.event!.month = new Date().toISOString().slice(0, 7);
    const journal = new UsageRecoveryJournal(path(), () => { throw new Error("database unavailable"); }, () => false);
    journal.submit(pending);
    const zero = () => ({ cost_microusd: 0, input_tokens: 0, output_tokens: 0, query_count: 0 });
    const registry = new UserCostBudgetRegistry({ getTotalsForDate: zero, getTotalsForMonth: zero }, (u, p) => journal.pendingCost(u, p));
    for (const limits of [
      { daily_cost_limit_microusd: 1, monthly_cost_limit_microusd: -1 },
      { daily_cost_limit_microusd: -1, monthly_cost_limit_microusd: 1 },
    ]) {
      const previous = registry.acquire("user", limits);
      previous.release();
      expect(() => registry.acquire("user", limits).check()).toThrow("dollar budget");
      expect(() => registry.acquire("other", limits).check()).not.toThrow();
    }
  });
});

it("retries independent recovery jobs even when one job keeps failing", () => {
  const completed = new Set<string>();
  const journal = new UsageRecoveryJournal(path(), (pending) => {
    if (pending.id === "blocked") throw new Error("unavailable row");
    completed.add(pending.id);
  }, (id) => completed.has(id));
  journal.submit({ id: "blocked", turnId: null });
  journal.submit({ id: "healthy", turnId: null });
  expect(completed.has("healthy")).toBe(true);
  expect(completed.has("blocked")).toBe(false);
});
