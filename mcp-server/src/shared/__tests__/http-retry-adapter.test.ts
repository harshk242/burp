import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { abortableSleep, attachRetry } from '../http-retry.js';
import { runWithToolCallContext } from '../tool-call-context.js';
import { basePolicy, rejection, stubAdapter, stubClient } from './retry-test-utils.js';

const realSleep = { deps: { sleep: abortableSleep } };

describe('first-attempt clamping', () => {
  it('cuts attempt 1 down to the time left in the tool call', async () => {
    const { client, calls } = stubClient([200], { perAttemptTimeoutMs: 30_000, totalBudgetMs: 40_000 });
    await runWithToolCallContext({ timeoutMs: 5_000 }, () => client.get('/x'));
    expect(calls[0].timeout).toBeLessThanOrEqual(5_000);
    expect(calls[0].timeout).toBeGreaterThan(4_000);
  });

  it('keeps a shorter caller timeout instead of raising it', async () => {
    const { client, calls } = stubClient([200]);
    await client.get('/x', { timeout: 2_000 });
    expect(calls[0].timeout).toBe(2_000);
  });

  it('caps a longer instance timeout with perAttemptTimeoutMs', async () => {
    const { client, calls } = stubClient([200], {}, { timeout: 60_000 });
    await client.get('/x');
    expect(calls[0].timeout).toBe(5_000);
  });

  it('gives an instance with timeout: 0 the policy timeout, not "no timeout"', async () => {
    const { client, calls } = stubClient([500, 200], {}, { timeout: 0 });
    await client.get('/x');
    expect(calls.map((c) => c.timeout)).toEqual([5_000, 5_000]);
  });
});

describe('active deadlines and cancellation', () => {
  it('aborts a backoff sleep as soon as the budget expires', async () => {
    const { client, calls } = stubClient([500], { backoffMs: [10_000], totalBudgetMs: 50 }, realSleep);
    const started = Date.now();
    const error = await rejection(client.get('/x'));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(error).toMatchObject({ kind: 'timeout', reason: 'budget_timeout', attempts: 1, status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('aborts a backoff sleep when the tool-call deadline fires', async () => {
    const { client, calls } = stubClient([500], { backoffMs: [10_000] }, realSleep);
    const started = Date.now();
    const error = await rejection(runWithToolCallContext({ timeoutMs: 50 }, () => client.get('/x')));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(error).toMatchObject({ reason: 'budget_timeout' });
    expect(calls).toHaveLength(1);
  });

  it('aborts a token wait in beforeAttempt when the budget expires', async () => {
    let seen: AbortSignal | undefined;
    const beforeAttempt = (signal: AbortSignal) => {
      seen = signal;
      return new Promise<void>(() => {}); // a limiter that ignores the signal
    };
    const { client, calls } = stubClient([200], { beforeAttempt, totalBudgetMs: 50 });
    const started = Date.now();
    const error = await rejection(client.get('/x'));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(error).toMatchObject({ reason: 'budget_timeout', attempts: 0 });
    expect(seen?.aborted).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('aborts a hanging attempt at the budget and does not retry', async () => {
    const { client, calls } = stubClient(['hang'], { totalBudgetMs: 50 });
    expect(await rejection(client.get('/x'))).toMatchObject({ reason: 'budget_timeout', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('retries an attempt that hits its own timeout while the budget allows', async () => {
    const { client, calls } = stubClient([{ status: 200, delayMs: 200 }, 200], { perAttemptTimeoutMs: 20 });
    await expect(client.get('/x')).resolves.toMatchObject({ status: 200 });
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['the caller signal', 'caller'],
    ['the MCP request signal', 'extra'],
  ])('reports cancelled during an attempt when %s aborts', async (_, source) => {
    const controller = new AbortController();
    const { client, calls } = stubClient(['hang']);
    setTimeout(() => controller.abort(), 20);
    const request =
      source === 'caller'
        ? client.get('/x', { signal: controller.signal })
        : runWithToolCallContext({ timeoutMs: 5_000, signal: controller.signal }, () => client.get('/x'));
    expect(await rejection(request)).toMatchObject({ kind: 'cancelled', reason: 'cancelled', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('reports cancelled during a backoff sleep, with no further requests', async () => {
    const controller = new AbortController();
    const { client, calls } = stubClient([500, 200], { backoffMs: [10_000] }, realSleep);
    setTimeout(() => controller.abort(), 20);
    expect(await rejection(client.get('/x', { signal: controller.signal }))).toMatchObject({ reason: 'cancelled' });
    expect(calls).toHaveLength(1);
  });

  it('reports cancelled during beforeAttempt, with no requests', async () => {
    const controller = new AbortController();
    const beforeAttempt = (signal: AbortSignal) => abortableSleep(10_000, signal);
    const { client, calls } = stubClient([200], { beforeAttempt });
    setTimeout(() => controller.abort(), 20);
    expect(await rejection(client.get('/x', { signal: controller.signal }))).toMatchObject({
      reason: 'cancelled',
      attempts: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it('fails a request made after the tool-call deadline as timeout without sending it', async () => {
    const { client, calls } = stubClient([200]);
    const error = await rejection(
      runWithToolCallContext({ timeoutMs: 20 }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return client.get('/x');
      }),
    );
    expect(error).toMatchObject({ kind: 'timeout', reason: 'budget_timeout', attempts: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('adapter wrapper', () => {
  it('runs request interceptors once per logical request, whatever the retries', async () => {
    const { client, calls } = stubClient([500, 500, 200]);
    const interceptor = vi.fn((config) => config);
    client.interceptors.request.use(interceptor);
    await client.get('/x');
    expect(calls).toHaveLength(3);
    expect(interceptor).toHaveBeenCalledTimes(1);
  });

  it('passes the combined signal to each attempt', async () => {
    const caller = new AbortController();
    const { client, calls } = stubClient([200]);
    await client.get('/x', { signal: caller.signal });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].signal).not.toBe(caller.signal);
  });

  it('refuses to attach twice to the same instance', () => {
    const { adapter } = stubAdapter([200]);
    const client = axios.create({ adapter });
    attachRetry(client, basePolicy, 'ensembl');
    expect(() => attachRetry(client, basePolicy, 'ensembl')).toThrow(/already attached/);
  });
});
