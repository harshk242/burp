import { describe, expect, it, vi } from 'vitest';
import type { RetryPolicy } from '../http-retry.js';
import { NCBI_EUTILS_BASE_URL, createNcbiHttp, getSharedNcbiRateLimiter } from '../ncbi-http.js';
import { TokenBucketRateLimiter } from '../rate-limiter.js';
import { basePolicy, stubAdapter } from './retry-test-utils.js';

const noSleep = { sleep: async () => {} };

describe('getSharedNcbiRateLimiter', () => {
  it('returns one limiter per API key, and one for keyless requests', () => {
    const keyless = getSharedNcbiRateLimiter(undefined);
    expect(getSharedNcbiRateLimiter(undefined)).toBe(keyless);
    expect(getSharedNcbiRateLimiter('')).toBe(keyless);

    const keyed = getSharedNcbiRateLimiter('key-a');
    expect(getSharedNcbiRateLimiter('key-a')).toBe(keyed);
    expect(keyed).not.toBe(keyless);
    expect(getSharedNcbiRateLimiter('key-b')).not.toBe(keyed);
  });

  it('allows 3 req/s without a key and 10 req/s with one', () => {
    expect(getSharedNcbiRateLimiter(undefined).getConfig().refillRate).toBe(3);
    expect(getSharedNcbiRateLimiter('key-rate').getConfig().refillRate).toBe(10);
  });

  it('allows a burst of one request so no second exceeds the NCBI limit by more than one', () => {
    expect(getSharedNcbiRateLimiter(undefined).getConfig().maxTokens).toBe(1);
    expect(getSharedNcbiRateLimiter('key-burst').getConfig().maxTokens).toBe(1);
  });

  it('bounds the queue at 10s of requests', () => {
    expect(getSharedNcbiRateLimiter(undefined).getConfig().maxQueueLength).toBe(30);
    expect(getSharedNcbiRateLimiter('key-queue').getConfig().maxQueueLength).toBe(100);
  });
});

describe('createNcbiHttp', () => {
  it('targets E-utilities', () => {
    const http = createNcbiHttp({ platform: 'pubmed', policy: basePolicy });
    expect(http.defaults.baseURL).toBe(NCBI_EUTILS_BASE_URL);
  });

  it('takes a token from the shared limiter for its key before every attempt', async () => {
    const shared = getSharedNcbiRateLimiter('key-factory');
    const waitForToken = vi.spyOn(shared, 'waitForToken').mockResolvedValue();
    const { adapter, calls } = stubAdapter([500, 200]);
    const http = createNcbiHttp({ platform: 'pubmed', policy: basePolicy, apiKey: 'key-factory', adapter, retryDeps: noSleep });

    await http.get('esearch.fcgi');
    expect(calls).toHaveLength(2);
    expect(waitForToken).toHaveBeenCalledTimes(2);
  });

  it('uses an injected limiter instead of the shared one', async () => {
    const injected = new TokenBucketRateLimiter({ requestsPerSecond: 100 });
    const waitForToken = vi.spyOn(injected, 'waitForToken');
    const shared = vi.spyOn(getSharedNcbiRateLimiter('key-injected'), 'waitForToken');
    const { adapter } = stubAdapter([200]);
    const http = createNcbiHttp({ platform: 'clinvar', policy: basePolicy, apiKey: 'key-injected', rateLimiter: injected, adapter });

    await http.get('esearch.fcgi');
    expect(waitForToken).toHaveBeenCalledTimes(1);
    expect(shared).not.toHaveBeenCalled();
  });

  it('replaces a beforeAttempt carried in the policy, so the limiter cannot be skipped', async () => {
    const bypass = vi.fn(async () => {});
    const policy: RetryPolicy = { ...basePolicy, beforeAttempt: bypass };
    const waitForToken = vi.spyOn(getSharedNcbiRateLimiter('key-bypass'), 'waitForToken').mockResolvedValue();
    const { adapter } = stubAdapter([200]);
    const http = createNcbiHttp({ platform: 'pubmed', policy, apiKey: 'key-bypass', adapter });

    await http.get('esearch.fcgi');
    expect(bypass).not.toHaveBeenCalled();
    expect(waitForToken).toHaveBeenCalledTimes(1);
  });
});
