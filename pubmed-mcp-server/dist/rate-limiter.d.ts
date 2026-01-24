import type { RateLimiterOptions } from './types.js';
export declare class TokenBucketRateLimiter {
    private tokens;
    private lastRefill;
    private readonly maxTokens;
    private readonly refillRate;
    private pendingRequests;
    constructor(options: RateLimiterOptions);
    /**
     * Refill tokens based on elapsed time
     */
    private refill;
    /**
     * Wait for a token to become available
     */
    waitForToken(): Promise<void>;
    /**
     * Try to acquire a token without waiting
     * Returns true if successful, false if no tokens available
     */
    tryAcquire(): boolean;
    /**
     * Get current token count
     */
    getAvailableTokens(): number;
    /**
     * Get the rate limit configuration
     */
    getConfig(): {
        maxTokens: number;
        refillRate: number;
    };
}
export declare function createRateLimiter(hasApiKey: boolean): TokenBucketRateLimiter;
//# sourceMappingURL=rate-limiter.d.ts.map