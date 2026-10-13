import { describe, it, expect, vi, afterEach } from 'vitest';
import { TokenBucketRateLimiter, createNcbiRateLimiter } from '../rate-limiter.js';

// ── TokenBucketRateLimiter ────────────────────────────────────────────────────

describe('TokenBucketRateLimiter', () => {
  describe('constructor', () => {
    it('uses requestsPerSecond as maxTokens when no burstSize given', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 5 });
      expect(limiter.getConfig().maxTokens).toBe(5);
    });

    it('uses burstSize as maxTokens when explicitly provided', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 5, burstSize: 10 });
      expect(limiter.getConfig().maxTokens).toBe(10);
    });

    it('sets refillRate to requestsPerSecond', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 7 });
      expect(limiter.getConfig().refillRate).toBe(7);
    });

    it('starts full (all maxTokens available)', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 5 });
      // Allow tiny floating-point drift from the immediate refill() call
      expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(4.99);
    });
  });

  describe('tryAcquire', () => {
    it('returns true and consumes a token when tokens are available', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 5 });
      const before = limiter.getAvailableTokens();
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.getAvailableTokens()).toBeLessThan(before);
    });

    it('returns false when bucket is exhausted', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 1, burstSize: 1 });
      limiter.tryAcquire(); // use the single token
      expect(limiter.tryAcquire()).toBe(false);
    });

    it('can acquire exactly maxTokens times in a row', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 3 });
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });
  });

  describe('getAvailableTokens', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns a value close to maxTokens on a fresh limiter', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 10 });
      expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(9.9);
    });

    it('refills tokens over time', () => {
      vi.useFakeTimers();
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 10, burstSize: 10 });
      // Exhaust bucket
      for (let i = 0; i < 10; i++) limiter.tryAcquire();
      expect(limiter.getAvailableTokens()).toBeCloseTo(0, 0);

      // Advance 500 ms — should refill ~5 tokens (10 req/s * 0.5 s)
      vi.advanceTimersByTime(500);
      expect(limiter.getAvailableTokens()).toBeGreaterThan(4);
    });

    it('never exceeds maxTokens after over-filling time', () => {
      vi.useFakeTimers();
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 5, burstSize: 5 });
      vi.advanceTimersByTime(10_000); // 10 s of refill
      expect(limiter.getAvailableTokens()).toBeLessThanOrEqual(5);
    });
  });

  describe('waitForToken', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves immediately when tokens are available', async () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 5 });
      const start = Date.now();
      await limiter.waitForToken();
      expect(Date.now() - start).toBeLessThan(50);
    });

    it('resolves after delay when bucket is exhausted', async () => {
      vi.useFakeTimers();
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 3, burstSize: 3 });
      // Exhaust all tokens
      limiter.tryAcquire();
      limiter.tryAcquire();
      limiter.tryAcquire();

      let resolved = false;
      const promise = limiter.waitForToken().then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);
      await vi.runAllTimersAsync();
      await promise;
      expect(resolved).toBe(true);
    });

    it('rejects at once with an already-aborted signal and takes no token', async () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 1, burstSize: 1 });
      const controller = new AbortController();
      controller.abort(new Error('stop'));
      await expect(limiter.waitForToken(controller.signal)).rejects.toThrow('stop');
      expect(limiter.tryAcquire()).toBe(true);
    });

    it('an abort during the wait rejects and removes the waiter from the queue', async () => {
      vi.useFakeTimers();
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 1, burstSize: 1 });
      limiter.tryAcquire();

      const controller = new AbortController();
      const aborted = limiter.waitForToken(controller.signal);
      const other = limiter.waitForToken();
      expect(limiter.getPendingCount()).toBe(2);

      controller.abort(new Error('stop'));
      await expect(aborted).rejects.toThrow('stop');
      expect(limiter.getPendingCount()).toBe(1);

      await vi.runAllTimersAsync();
      await expect(other).resolves.toBeUndefined();
      expect(limiter.getPendingCount()).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('returns correct maxTokens and refillRate', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 8, burstSize: 16 });
      expect(limiter.getConfig()).toEqual({ maxTokens: 16, refillRate: 8 });
    });
  });
});

// ── createNcbiRateLimiter ─────────────────────────────────────────────────────

describe('createNcbiRateLimiter', () => {
  it('creates 3 req/s limiter without API key', () => {
    const limiter = createNcbiRateLimiter(false);
    expect(limiter.getConfig().refillRate).toBe(3);
  });

  it('creates 10 req/s limiter with API key', () => {
    const limiter = createNcbiRateLimiter(true);
    expect(limiter.getConfig().refillRate).toBe(10);
  });

  it('burst size is 2× rate without API key (6)', () => {
    expect(createNcbiRateLimiter(false).getConfig().maxTokens).toBe(6);
  });

  it('burst size is 2× rate with API key (20)', () => {
    expect(createNcbiRateLimiter(true).getConfig().maxTokens).toBe(20);
  });

  it('starts with full burst bucket', () => {
    const limiter = createNcbiRateLimiter(false);
    // Should be able to immediately acquire up to burstSize (6) times
    let acquired = 0;
    while (limiter.tryAcquire()) acquired++;
    expect(acquired).toBe(6);
  });
});
