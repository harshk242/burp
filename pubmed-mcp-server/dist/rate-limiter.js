// Token Bucket Rate Limiter for NCBI API
// - 3 requests/second without API key
// - 10 requests/second with API key
export class TokenBucketRateLimiter {
    tokens;
    lastRefill;
    maxTokens;
    refillRate; // tokens per second
    pendingRequests = [];
    constructor(options) {
        this.maxTokens = options.burstSize || options.requestsPerSecond;
        this.refillRate = options.requestsPerSecond;
        this.tokens = this.maxTokens;
        this.lastRefill = Date.now();
    }
    /**
     * Refill tokens based on elapsed time
     */
    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000; // seconds
        const tokensToAdd = elapsed * this.refillRate;
        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }
    /**
     * Wait for a token to become available
     */
    async waitForToken() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }
        // Calculate wait time until next token
        const tokensNeeded = 1 - this.tokens;
        const waitTime = (tokensNeeded / this.refillRate) * 1000; // milliseconds
        return new Promise((resolve) => {
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
    /**
     * Try to acquire a token without waiting
     * Returns true if successful, false if no tokens available
     */
    tryAcquire() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }
    /**
     * Get current token count
     */
    getAvailableTokens() {
        this.refill();
        return this.tokens;
    }
    /**
     * Get the rate limit configuration
     */
    getConfig() {
        return {
            maxTokens: this.maxTokens,
            refillRate: this.refillRate,
        };
    }
}
// Factory function to create a rate limiter based on API key presence
export function createRateLimiter(hasApiKey) {
    const requestsPerSecond = hasApiKey ? 10 : 3;
    return new TokenBucketRateLimiter({
        requestsPerSecond,
        burstSize: requestsPerSecond * 2, // Allow small bursts
    });
}
//# sourceMappingURL=rate-limiter.js.map