import axios, { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '../exceptions.js';
import { abortableSleep, attachRetry, withRetry } from '../http-retry.js';
import { runWithToolCallContext } from '../tool-call-context.js';
import { basePolicy, rejection, stubAdapter, stubClient } from './retry-test-utils.js';

const realSleep = { deps: { sleep: abortableSleep } };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function rejectionAfter(promise: Promise<unknown>, ms: number): Promise<{ error: any; elapsed: number | undefined }> {
  const started = Date.now();
  let elapsed: number | undefined;
  const settled = rejection(promise).finally(() => {
    elapsed = Date.now() - started;
  });
  await vi.advanceTimersByTimeAsync(ms);
  return { error: await settled, elapsed };
}

describe('first-attempt clamping', () => {
  it('cuts attempt 1 down to the time left in the tool call', async () => {
    const { client, calls } = stubClient([200], { perAttemptTimeoutMs: 30_000, totalBudgetMs: 40_000 });
    await runWithToolCallContext({ timeoutMs: 5_000 }, () => client.get('/x'));
    expect(calls[0].timeout).toBe(5_000);
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
    const { error, elapsed } = await rejectionAfter(client.get('/x'), 50);
    expect(elapsed).toBe(50);
    expect(error).toMatchObject({ kind: 'timeout', reason: 'budget_timeout', attempts: 1, status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('aborts a backoff sleep when the tool-call deadline fires', async () => {
    const { client, calls } = stubClient([500], { backoffMs: [10_000] }, realSleep);
    const request = runWithToolCallContext({ timeoutMs: 50 }, () => client.get('/x'));
    const { error, elapsed } = await rejectionAfter(request, 50);
    expect(elapsed).toBe(50);
    expect(error).toMatchObject({ reason: 'budget_timeout' });
    expect(calls).toHaveLength(1);
  });

  it('aborts a token wait in beforeAttempt when the budget expires', async () => {
    let seen: AbortSignal | undefined;
    const beforeAttempt = (signal: AbortSignal) => {
      seen = signal;
      return new Promise<void>(() => {});
    };
    const { client, calls } = stubClient([200], { beforeAttempt, totalBudgetMs: 50 });
    const { error, elapsed } = await rejectionAfter(client.get('/x'), 50);
    expect(elapsed).toBe(50);
    expect(error).toMatchObject({ reason: 'budget_timeout', attempts: 0 });
    expect(seen?.aborted).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('aborts a hanging attempt at the budget and does not retry', async () => {
    const { client, calls } = stubClient(['hang'], { totalBudgetMs: 50 });
    const { error, elapsed } = await rejectionAfter(client.get('/x'), 50);
    expect(elapsed).toBe(50);
    expect(error).toMatchObject({ reason: 'budget_timeout', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('retries an attempt that hits its own timeout while the budget allows', async () => {
    const { client, calls } = stubClient([{ status: 200, delayMs: 200 }, 200], { perAttemptTimeoutMs: 20 });
    const request = client.get('/x');
    await vi.advanceTimersByTimeAsync(20);
    await expect(request).resolves.toMatchObject({ status: 200 });
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
    const { error, elapsed } = await rejectionAfter(request, 20);
    expect(elapsed).toBe(20);
    expect(error).toMatchObject({ kind: 'cancelled', reason: 'cancelled', attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it('reports cancelled during a backoff sleep, with no further requests', async () => {
    const controller = new AbortController();
    const { client, calls } = stubClient([500, 200], { backoffMs: [10_000] }, realSleep);
    setTimeout(() => controller.abort(), 20);
    const { error } = await rejectionAfter(client.get('/x', { signal: controller.signal }), 20);
    expect(error).toMatchObject({ reason: 'cancelled' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(1);
  });

  it('reports cancelled during beforeAttempt, with no requests', async () => {
    const controller = new AbortController();
    const beforeAttempt = (signal: AbortSignal) => abortableSleep(10_000, signal);
    const { client, calls } = stubClient([200], { beforeAttempt });
    setTimeout(() => controller.abort(), 20);
    const { error } = await rejectionAfter(client.get('/x', { signal: controller.signal }), 20);
    expect(error).toMatchObject({ reason: 'cancelled', attempts: 0 });
    expect(calls).toHaveLength(0);
  });

  it('fails a request made after the tool-call deadline as timeout without sending it', async () => {
    const { client, calls } = stubClient([200]);
    const request = runWithToolCallContext({ timeoutMs: 20 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return client.get('/x');
    });
    const { error } = await rejectionAfter(request, 40);
    expect(error).toMatchObject({ kind: 'timeout', reason: 'budget_timeout', attempts: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('uncooperative attempts (ignore the abort signal)', () => {
  const ignoringAdapter = (delayMs: number) => {
    const calls: InternalAxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = (config) => {
      calls.push(config);
      return new Promise((resolve) => {
        setTimeout(() => resolve({ data: 'late', status: 200, statusText: 'OK', headers: {}, config }), delayMs);
      });
    };
    const client = axios.create({ adapter });
    attachRetry(client, { ...basePolicy, totalBudgetMs: 50 }, 'ensembl', { sleep: async () => {} });
    return { client, calls };
  };

  it('fails at the budget instead of waiting for the attempt', async () => {
    const { client, calls } = ignoringAdapter(10_000);
    const { error, elapsed } = await rejectionAfter(client.get('/x'), 50);
    expect(elapsed).toBe(50);
    expect(error).toMatchObject({ reason: 'budget_timeout', attempts: 1, status: null });
    expect(calls).toHaveLength(1);
  });

  it('reports cancelled when the caller aborts, and discards the late response', async () => {
    const { client } = ignoringAdapter(30);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const { error, elapsed } = await rejectionAfter(client.get('/x', { signal: controller.signal }), 100);
    expect(elapsed).toBe(10);
    expect(error).toMatchObject({ reason: 'cancelled', attempts: 1 });
  });

  it('withRetry: a result that resolves after the caller aborted is not a success', async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      controller.abort();
      return 'late';
    });
    const error = await rejection(withRetry(fn, basePolicy, { platform: 'p', signal: controller.signal }));
    expect(error).toMatchObject({ reason: 'cancelled', attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('withRetry: a result that resolves after the budget expired is not a success', async () => {
    const fn = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 100)));
    const request = withRetry(fn, { ...basePolicy, totalBudgetMs: 50 }, { platform: 'p' });
    const { error, elapsed } = await rejectionAfter(request, 200);
    expect(elapsed).toBe(50);
    expect(error).toMatchObject({ reason: 'budget_timeout', attempts: 1 });
  });
});

describe('cancellation at the Axios request boundary', () => {
  it('turns an already-aborted signal into UpstreamError(cancelled) without sending', async () => {
    const { client, calls } = stubClient([200]);
    const controller = new AbortController();
    controller.abort();
    const meta = await runWithToolCallContext({ timeoutMs: 5_000 }, async (context) => {
      const error = await rejection(client.get('/x', { signal: controller.signal }));
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error).toMatchObject({ kind: 'cancelled', reason: 'cancelled', attempts: 0 });
      return context.buildRetryMeta({ isError: true });
    });
    expect(calls).toHaveLength(0);
    expect(meta?.requests[0]).toMatchObject({ attempts: 0, outcome: 'cancelled', reason: 'cancelled' });
  });

  it('turns an abort while a request interceptor runs into UpstreamError(cancelled)', async () => {
    const { client, calls } = stubClient([200]);
    const controller = new AbortController();
    let seenSignal: unknown;
    client.interceptors.request.use(async (config) => {
      seenSignal = config.signal;
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();
      return config;
    });
    const { error } = await rejectionAfter(client.get('/x', { signal: controller.signal }), 10);
    expect(error).toMatchObject({ kind: 'cancelled', reason: 'cancelled', attempts: 0 });
    expect(seenSignal).toBe(controller.signal);
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

describe('error response bodies', () => {
  function failingClient(body: string, contentType: string) {
    const adapter: AxiosAdapter = async (config) => {
      const response = {
        data: body,
        status: 400,
        statusText: 'Bad Request',
        headers: new AxiosHeaders({ 'content-type': contentType }),
        config,
      };
      throw new AxiosError('Request failed with status code 400', AxiosError.ERR_BAD_REQUEST, config, null, response);
    };
    return attachRetry(axios.create({ adapter }), basePolicy, 'p', { sleep: async () => {} });
  }

  it('runs transformResponse on the failed response kept as the UpstreamError cause', async () => {
    const client = failingClient('{"message":"Unknown field Nope"}', 'application/json');
    const error = await rejection(client.get('/x'));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.cause.response.data).toEqual({ message: 'Unknown field Nope' });
    expect(error.cause.response.headers).toBeInstanceOf(AxiosHeaders);
  });

  it('leaves a non-JSON body as the raw string', async () => {
    const client = failingClient('Invalid value', 'text/plain');
    const error = await rejection(client.get('/x'));
    expect(error.cause.response.data).toBe('Invalid value');
  });

  it('keeps the raw body and the UpstreamError when the transform throws', async () => {
    const adapter: AxiosAdapter = async (config) => {
      const response = { data: '{not json', status: 400, statusText: 'Bad Request', headers: {}, config };
      throw new AxiosError('Request failed with status code 400', AxiosError.ERR_BAD_REQUEST, config, null, response);
    };
    const client = attachRetry(
      axios.create({ adapter, responseType: 'json', transitional: { silentJSONParsing: false } }),
      basePolicy,
      'p',
      { sleep: async () => {} },
    );
    const error = await rejection(client.get('/x'));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ kind: 'bad_request', status: 400 });
    expect(error.cause.response.data).toBe('{not json');
  });
});
