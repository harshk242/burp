export interface LifecycleDeps {
  shutdownTracing: () => Promise<void>;
  stopMcp: () => Promise<void>;
  stopBackground?: () => void | Promise<void>;
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
    return await Promise.race([promise.then(() => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

export class RunLifecycle {
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

  get stopping(): boolean {
    return this.stoppingFlag;
  }

  get signalExitCode(): number | null {
    return this.signalName ? (SIGNAL_EXIT[this.signalName] ?? 1) : null;
  }

  track<T>(label: string, promise: Promise<T>): Promise<T> {
    this.active.set(promise, label);
    const forget = () => this.active.delete(promise);
    promise.then(forget, forget);
    return promise;
  }

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

  cleanup(): Promise<void> {
    this.cleanupPromise ??= this.runCleanup();
    return this.cleanupPromise;
  }

  private async runCleanup(): Promise<void> {
    this.stoppingFlag = true;
    await this.stage("background stop", () => this.deps.stopBackground?.());
    const drainMs = this.deps.drainTimeoutMs ?? 30_000;
    await this.stage("drain", async () => {
      if (this.active.size > 0 && !(await bounded(Promise.allSettled([...this.active.keys()]), drainMs))) {
        this.log(`drain timed out after ${drainMs} ms; still running: ${[...this.active.values()].join(", ")}`);
      }
    });
    await this.stage("tracing flush", () => this.deps.shutdownTracing());
    const mcpMs = this.deps.mcpStopTimeoutMs ?? 5_000;
    await this.stage("MCP stop", async () => {
      const stop = Promise.resolve().then(() => this.deps.stopMcp());
      if (!(await bounded(stop, mcpMs))) {
        this.log(`MCP stop timed out after ${mcpMs} ms`);
      }
    });
  }

  private async stage(name: string, run: () => void | Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.log(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
