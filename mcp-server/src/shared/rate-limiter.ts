export interface RateLimiterOptions {
  requestsPerSecond: number;
  burstSize?: number;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private pendingRequests: Array<() => void> = [];
  private drainTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: RateLimiterOptions) {
    this.maxTokens = options.burstSize || options.requestsPerSecond;
    this.refillRate = options.requestsPerSecond;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  private drain(): void {
    clearTimeout(this.drainTimer);
    this.drainTimer = undefined;
    this.refill();
    while (this.pendingRequests.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.pendingRequests.shift()!();
    }
    if (this.pendingRequests.length > 0) {
      const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
      this.drainTimer = setTimeout(() => this.drain(), waitTime);
    }
  }

  /**
   * Takes a token, waiting for one if the bucket is empty or others are
   * already waiting. An abort rejects with the signal's reason and removes
   * the waiter from the queue.
   */
  async waitForToken(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    this.refill();
    if (this.pendingRequests.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = this.pendingRequests.indexOf(waiter);
        if (index !== -1) this.pendingRequests.splice(index, 1);
        if (this.pendingRequests.length === 0) {
          clearTimeout(this.drainTimer);
          this.drainTimer = undefined;
        }
        reject(signal!.reason);
      };
      const waiter = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pendingRequests.push(waiter);
      this.drain();
    });
  }

  getPendingCount(): number {
    return this.pendingRequests.length;
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  getConfig(): { maxTokens: number; refillRate: number } {
    return { maxTokens: this.maxTokens, refillRate: this.refillRate };
  }
}

export function createNcbiRateLimiter(hasApiKey: boolean): TokenBucketRateLimiter {
  const requestsPerSecond = hasApiKey ? 10 : 3;
  return new TokenBucketRateLimiter({
    requestsPerSecond,
    burstSize: requestsPerSecond * 2,
  });
}
