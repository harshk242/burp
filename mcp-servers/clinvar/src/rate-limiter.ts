// Token Bucket Rate Limiter for NCBI API
// - 3 requests/second without API key
// - 10 requests/second with API key

import type { RateLimiterOptions } from './types.js';

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

  async waitForToken(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const tokensNeeded = 1 - this.tokens;
    const waitTime = (tokensNeeded / this.refillRate) * 1000;

    return new Promise<void>((resolve) => {
      this.pendingRequests.push(resolve);
      setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        const nextRequest = this.pendingRequests.shift();
        if (nextRequest) {
          nextRequest();
        }
      }, waitTime);
    });
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
    return {
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
    };
  }
}

export function createRateLimiter(hasApiKey: boolean): TokenBucketRateLimiter {
  const requestsPerSecond = hasApiKey ? 10 : 3;
  return new TokenBucketRateLimiter({
    requestsPerSecond,
    burstSize: requestsPerSecond * 2,
  });
}
