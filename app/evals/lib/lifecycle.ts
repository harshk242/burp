/**
 * Signal-safe cleanup for the experiment runner (plan 2.1 step 2).
 *
 * Aborting doesn't finish a turn synchronously: each processChat generator
 * still has to reach its `finally` (span end, failed-turn rows, online scores).
 * Tracing is flushed only after that, so nothing is dropped. A signal:
 *   1. stops scheduling (no new item, no new turn),
 *   2. aborts the run's signal (in-flight turns end as `aborted`),
 *   3. drains the tracked tasks (bounded, 30 s; stragglers are logged),
 *   4. flushes tracing (spans + score queue),
 *   5. stops MCP (bounded).
 * Normal completion and failure run steps 3–5 in the same order through the
 * same idempotent `cleanup()`. A second signal exits immediately.
 */

export interface LifecycleDeps {
  shutdownTracing: () => Promise<void>;
  stopMcp: () => Promise<void>;
  /** Stops background work (embedding sync) before the drain. */
  stopBackground?: () => void;
  log?: (line: string) => void;
  exit?: (code: number) => void;
  drainTimeoutMs?: number;
  mcpStopTimeoutMs?: number;
}

const SIGNAL_EXIT: Record<string, number> = { SIGINT: 130, SIGTERM: 143 };

async function bounded(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  try {
    return await Promise.race([promise.then(() => true, () => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

export class RunLifecycle {
  /** Passed to every processChat; aborted on a signal. */
  readonly abort = new AbortController();
  private stoppingFlag = false;
  private signalName: string | null = null;
  private readonly active = new Map<Promise<unknown>, string>();
  private cleanupPromise: Promise<void> | null = null;
  private readonly log: (line: string) => void;
  private readonly exit: (code: number) => void;

  constructor(private readonly deps: LifecycleDeps) {
    this.log = deps.log ?? ((line) => console.error(line));
    this.exit = deps.exit ?? ((code) => process.exit(code));
  }

  /** True once a signal arrived: launch no new item or turn. */
  get stopping(): boolean {
    return this.stoppingFlag;
  }

  /** The exit code a signal asks for, or null. */
  get signalExitCode(): number | null {
    return this.signalName ? (SIGNAL_EXIT[this.signalName] ?? 1) : null;
  }

  /** Tracks a running task until it settles; `cleanup` waits for it. */
  track<T>(label: string, promise: Promise<T>): Promise<T> {
    this.active.set(promise, label);
    const forget = () => this.active.delete(promise);
    promise.then(forget, forget);
    return promise;
  }

  /** Installs SIGINT/SIGTERM handlers; returns their removal. */
  installSignalHandlers(): () => void {
    const onInt = () => void this.onSignal("SIGINT");
    const onTerm = () => void this.onSignal("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    return () => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
    };
  }

  async onSignal(signal: string): Promise<void> {
    if (this.signalName) {
      this.log(`${signal} again: exiting now`);
      this.exit(SIGNAL_EXIT[signal] ?? 1);
      return;
    }
    this.signalName = signal;
    this.log(`${signal}: stopping (no new items), aborting running turns, draining…`);
    this.stoppingFlag = true;
    this.abort.abort(new Error(`eval run interrupted (${signal})`));
    await this.cleanup();
    this.exit(this.signalExitCode!);
  }

  /** Steps 3–5 once (later calls return the first call's promise). Never rejects. */
  cleanup(): Promise<void> {
    this.cleanupPromise ??= this.runCleanup();
    return this.cleanupPromise;
  }

  private async runCleanup(): Promise<void> {
    this.stoppingFlag = true;
    this.deps.stopBackground?.();
    const drainMs = this.deps.drainTimeoutMs ?? 30_000;
    if (this.active.size > 0 && !(await bounded(Promise.allSettled([...this.active.keys()]), drainMs))) {
      this.log(`drain timed out after ${drainMs} ms; still running: ${[...this.active.values()].join(", ")}`);
    }
    try {
      await this.deps.shutdownTracing();
    } catch (error) {
      this.log(`tracing flush failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const mcpMs = this.deps.mcpStopTimeoutMs ?? 5_000;
    if (!(await bounded(this.deps.stopMcp(), mcpMs))) this.log(`MCP stop timed out after ${mcpMs} ms`);
  }
}
