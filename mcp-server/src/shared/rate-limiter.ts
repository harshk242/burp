import { RateLimiterQueueFullError } from './exceptions.js';

export interface RateLimiterOptions {
  requestsPerSecond: number;
  burstSize?: number;
  /** Waiters allowed in the queue; once full, `waitForToken` rejects at once. Unbounded by default. */
  maxQueueLength?: number;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly maxQueueLength: number;
  private pendingRequests: Array<() => void> = [];
  private drainTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: RateLimiterOptions) {
    this.maxTokens = options.burstSize || options.requestsPerSecond;
    this.refillRate = options.requestsPerSecond;
    this.maxQueueLength = options.maxQueueLength ?? Infinity;
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

  async waitForToken(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    this.refill();
    if (this.pendingRequests.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    if (this.pendingRequests.length >= this.maxQueueLength) {
      // How long this request would have waited behind the current queue.
      const tokensNeeded = this.pendingRequests.length + 1 - this.tokens;
      throw new RateLimiterQueueFullError(Math.ceil((tokensNeeded / this.refillRate) * 1000));
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

  getConfig(): { maxTokens: number; refillRate: number; maxQueueLength: number } {
    return { maxTokens: this.maxTokens, refillRate: this.refillRate, maxQueueLength: this.maxQueueLength };
  }
}

/** Longest wait, in seconds, a full NCBI queue may cause before new requests fail fast. */
export const NCBI_MAX_QUEUE_WAIT_SECONDS = 10;

/**
 * NCBI E-utilities allow 3 req/s per IP without an API key and 10 req/s per key,
 * across all E-utilities and databases. A burst of one keeps any one-second
 * window within one request of that limit.
 */
export function createNcbiRateLimiter(hasApiKey: boolean): TokenBucketRateLimiter {
  const requestsPerSecond = hasApiKey ? 10 : 3;
  return new TokenBucketRateLimiter({
    requestsPerSecond,
    burstSize: 1,
    maxQueueLength: requestsPerSecond * NCBI_MAX_QUEUE_WAIT_SECONDS,
  });
}

const sharedNcbiLimiters = new Map<string, TokenBucketRateLimiter>();

/**
 * The process-wide NCBI limiter for an API key (or for keyless requests), shared
 * by every NCBI client (PubMed, ClinVar) because the limit covers them together.
 */
export function getSharedNcbiRateLimiter(apiKey: string | undefined): TokenBucketRateLimiter {
  const key = apiKey ?? '';
  let limiter = sharedNcbiLimiters.get(key);
  if (!limiter) {
    limiter = createNcbiRateLimiter(key !== '');
    sharedNcbiLimiters.set(key, limiter);
  }
  return limiter;
}
