// Token Bucket Rate Limiter for NCBI API
// - 3 requests/second without API key
// - 10 requests/second with API key
export class TokenBucketRateLimiter {
    tokens;
    lastRefill;
    maxTokens;
    refillRate;
    pendingRequests = [];
    constructor(options) {
        this.maxTokens = options.burstSize || options.requestsPerSecond;
        this.refillRate = options.requestsPerSecond;
        this.tokens = this.maxTokens;
        this.lastRefill = Date.now();
    }
    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        const tokensToAdd = elapsed * this.refillRate;
        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }
    async waitForToken() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }
        const tokensNeeded = 1 - this.tokens;
        const waitTime = (tokensNeeded / this.refillRate) * 1000;
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
    tryAcquire() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }
    getAvailableTokens() {
        this.refill();
        return this.tokens;
    }
    getConfig() {
        return {
            maxTokens: this.maxTokens,
            refillRate: this.refillRate,
        };
    }
}
export function createRateLimiter(hasApiKey) {
    const requestsPerSecond = hasApiKey ? 10 : 3;
    return new TokenBucketRateLimiter({
        requestsPerSecond,
        burstSize: requestsPerSecond * 2,
    });
}
//# sourceMappingURL=rate-limiter.js.map