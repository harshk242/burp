import type { RateLimiterOptions } from './types.js';
export declare class TokenBucketRateLimiter {
    private tokens;
    private lastRefill;
    private readonly maxTokens;
    private readonly refillRate;
    private pendingRequests;
    constructor(options: RateLimiterOptions);
    private refill;
    waitForToken(): Promise<void>;
    tryAcquire(): boolean;
    getAvailableTokens(): number;
    getConfig(): {
        maxTokens: number;
        refillRate: number;
    };
}
export declare function createRateLimiter(hasApiKey: boolean): TokenBucketRateLimiter;
//# sourceMappingURL=rate-limiter.d.ts.map