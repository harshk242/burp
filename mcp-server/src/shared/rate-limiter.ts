// Token Bucket Rate Limiter for NCBI API
// - 3 requests/second without API key
// - 10 requests/second with API key

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

  /**
   * Takes a token, waiting for one if the bucket is empty. An abort rejects
   * with the signal's reason and removes the waiter from the queue.
   */
  async waitForToken(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const tokensNeeded = 1 - this.tokens;
    const waitTime = (tokensNeeded / this.refillRate) * 1000;

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        // Drop this waiter and its timer so the queue and timers stay paired.
        clearTimeout(timer);
        const index = this.pendingRequests.indexOf(waiter);
        if (index !== -1) this.pendingRequests.splice(index, 1);
        reject(signal!.reason);
      };
      const waiter = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      this.pendingRequests.push(waiter);
      const timer = setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        const nextRequest = this.pendingRequests.shift();
        if (nextRequest) {
          nextRequest();
        }
      }, waitTime);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Number of callers waiting for a token. */
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
