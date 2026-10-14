import { describe, it, expect, vi, afterEach } from 'vitest';
import { TokenBucketRateLimiter, createNcbiRateLimiter } from '../rate-limiter.js';

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
      limiter.tryAcquire();
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
      for (let i = 0; i < 10; i++) limiter.tryAcquire();
      expect(limiter.getAvailableTokens()).toBeCloseTo(0, 0);

      vi.advanceTimersByTime(500);
      expect(limiter.getAvailableTokens()).toBeGreaterThan(4);
    });

    it('never exceeds maxTokens after over-filling time', () => {
      vi.useFakeTimers();
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 5, burstSize: 5 });
      vi.advanceTimersByTime(10_000);
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

    it('a later waiter whose wait ends first, then aborts, leaves no timer behind to consume tokens', async () => {
      vi.useFakeTimers();
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 1, burstSize: 1 });
      limiter.tryAcquire();

      let firstResolved = false;
      const first = limiter.waitForToken().then(() => {
        firstResolved = true;
      });
      vi.setSystemTime(Date.now() + 900);
      const controller = new AbortController();
      const second = limiter.waitForToken(controller.signal);

      await vi.advanceTimersByTimeAsync(150);
      await first;
      expect(firstResolved).toBe(true);
      expect(limiter.getPendingCount()).toBe(1);

      controller.abort(new Error('stop'));
      await expect(second).rejects.toThrow('stop');
      expect(limiter.getPendingCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);

      await vi.runAllTimersAsync();
      expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(0);
      vi.advanceTimersByTime(1_000);
      expect(limiter.tryAcquire()).toBe(true);
    });

    it('serves waiters in order and takes exactly one token per waiter', async () => {
      vi.useFakeTimers();
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 2, burstSize: 2 });
      limiter.tryAcquire();
      limiter.tryAcquire();

      const order: number[] = [];
      const waits = [1, 2, 3].map((n) => limiter.waitForToken().then(() => order.push(n)));
      await vi.advanceTimersByTimeAsync(500);
      expect(order).toEqual([1]);
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.all(waits);
      expect(order).toEqual([1, 2, 3]);
      expect(limiter.getAvailableTokens()).toBeCloseTo(0, 5);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('returns correct maxTokens and refillRate', () => {
      const limiter = new TokenBucketRateLimiter({ requestsPerSecond: 8, burstSize: 16 });
      expect(limiter.getConfig()).toEqual({ maxTokens: 16, refillRate: 8 });
    });
  });
});

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
    let acquired = 0;
    while (limiter.tryAcquire()) acquired++;
    expect(acquired).toBe(6);
  });
});
