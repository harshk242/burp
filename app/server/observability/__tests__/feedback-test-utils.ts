import type { Queries } from "../../db/queries";
import type { ScoreUpsert, ScoreWriter } from "../score-writer";

export type WriterOp = "upsert" | "remove" | "exists";

export interface HeldCall {
  op: WriterOp;
  id: string;
  body?: ScoreUpsert;
  resolve(): void;
  reject(error: unknown): void;
}

/**
 * In `auto` mode calls apply to `remote` and resolve at once (`existsAnswer`
 * can override what `exists` returns). In `manual` mode each call matching
 * `hold` waits in `held` until the test resolves or rejects it; resolving
 * applies it. `failWhen` rejects a matching call with the returned error.
 */
export class FakeScoreWriter implements ScoreWriter {
  readonly remote = new Map<string, ScoreUpsert>();
  readonly log: { op: WriterOp; id: string; value?: number }[] = [];
  readonly held: HeldCall[] = [];
  mode: "auto" | "manual" = "auto";
  failNext: unknown[] = [];
  existsAnswer: ((id: string) => boolean) | null = null;
  hold: (op: WriterOp, id: string) => boolean = () => true;
  failWhen: ((op: WriterOp, id: string) => unknown) | null = null;
  /** When set, acknowledged deletes are queued (as Langfuse does) and apply only on `landDeletes()`. */
  deferDeletes = false;
  private queuedDeletes: string[] = [];
  private waiters: (() => void)[] = [];

  upsert(body: ScoreUpsert): Promise<void> {
    return this.call("upsert", body.id, body);
  }
  remove(id: string): Promise<void> {
    return this.call("remove", id);
  }
  async exists(id: string): Promise<boolean> {
    await this.call("exists", id);
    return this.existsAnswer ? this.existsAnswer(id) : this.remote.has(id);
  }

  /** Waits until a call is held (manual mode) and returns the oldest one. */
  async nextHeld(): Promise<HeldCall> {
    while (this.held.length === 0) await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.held.shift()!;
  }

  /** Applies the acknowledged deletes queued while `deferDeletes` was set. */
  landDeletes(): void {
    for (const id of this.queuedDeletes.splice(0)) this.remote.delete(id);
  }

  private apply(op: WriterOp, id: string, body?: ScoreUpsert) {
    if (op === "upsert") this.remote.set(id, body!);
    if (op === "remove") {
      if (this.deferDeletes) this.queuedDeletes.push(id);
      else this.remote.delete(id);
    }
  }

  private call(op: WriterOp, id: string, body?: ScoreUpsert): Promise<void> {
    this.log.push({ op, id, ...(body ? { value: body.value } : {}) });
    if (this.failNext.length > 0) return Promise.reject(this.failNext.shift());
    const failure = this.failWhen?.(op, id);
    if (failure) return Promise.reject(failure);
    if (this.mode === "auto" || !this.hold(op, id)) {
      this.apply(op, id, body);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.held.push({
        op,
        id,
        body,
        resolve: () => {
          this.apply(op, id, body);
          resolve();
        },
        reject,
      });
      for (const wake of this.waiters.splice(0)) wake();
    });
  }
}

export const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  otherUser: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333",
  userMessage: "44444444-4444-4444-8444-444444444444",
  assistantMessage: "55555555-5555-4555-8555-555555555555",
  turn: "66666666-6666-4666-8666-666666666666",
  traceId: "0123456789abcdef0123456789abcdef",
};

/** Two users; a session of `ids.user` with one turn whose assistant message is traced (unless `traceId` is null). */
export function seedTracedTurn(q: Queries, traceId: string | null = ids.traceId): void {
  q.userQueries.create(ids.user, "clerk-1", "one@example.com", "One", null, "user", null, null);
  q.userQueries.create(ids.otherUser, "clerk-2", "two@example.com", "Two", null, "user", null, null);
  q.chatSessionQueries.create(ids.session, ids.user, "Chat");
  q.messageQueries.create(ids.userMessage, ids.session, "user", "question", null);
  q.messageQueries.create(ids.assistantMessage, ids.session, "assistant", "answer", null);
  q.chatTurnQueries.start(ids.turn, ids.session, ids.userMessage);
  if (traceId) q.chatTurnQueries.setTraceId(ids.turn, traceId);
  q.chatTurnQueries.finish(ids.turn, { status: "ok", iterations: 1, assistantMessageId: ids.assistantMessage });
}
