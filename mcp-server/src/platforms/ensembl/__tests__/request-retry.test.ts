import axios, { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import {
  getEnsemblContractRetryDelay,
  retryEnsemblContractRequest,
  shouldRetryEnsemblContractRequest,
} from './request-retry.js';

function axiosFailure(options: {
  code?: string;
  message?: string;
  status?: number;
  headers?: Record<string, string>;
}): AxiosError {
  const error = new AxiosError(options.message ?? 'request failed', options.code);
  if (options.status !== undefined) {
    error.response = {
      data: undefined,
      status: options.status,
      statusText: 'Error',
      headers: options.headers ?? {},
      config: error.config!,
    };
  }
  return error;
}

describe('Ensembl contract request retry', () => {
  it('returns a successful first request without sleeping', async () => {
    const request = vi.fn().mockResolvedValue({ data: 'ok' });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(retryEnsemblContractRequest(request, { sleep })).resolves.toEqual({ data: 'ok' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    ['a timeout', axiosFailure({ code: 'ECONNABORTED' })],
    ['a network error', axiosFailure({ code: 'ERR_NETWORK' })],
    ['an HTTP 5xx response', axiosFailure({ status: 503 })],
  ])('retries once after %s and returns the second response', async (_, failure) => {
    const request = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(retryEnsemblContractRequest(request, { sleep })).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('retries HTTP 408 and honors a valid Retry-After value for HTTP 429', async () => {
    const timeout = axiosFailure({ status: 408 });
    const rateLimit = axiosFailure({ status: 429, headers: { 'retry-after': '2' } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce('408 retried');

    await expect(retryEnsemblContractRequest(request, { sleep })).resolves.toBe('408 retried');
    expect(sleep).toHaveBeenLastCalledWith(500);

    request.mockReset().mockRejectedValueOnce(rateLimit).mockResolvedValueOnce('429 retried');
    await expect(retryEnsemblContractRequest(request, { sleep })).resolves.toBe('429 retried');
    expect(sleep).toHaveBeenLastCalledWith(2_000);
  });

  it('uses the fallback delay for missing or invalid Retry-After headers', () => {
    expect(getEnsemblContractRetryDelay(axiosFailure({ status: 429 }))).toBe(500);
    expect(
      getEnsemblContractRetryDelay(axiosFailure({ status: 429, headers: { 'retry-after': 'soon' } })),
    ).toBe(500);
  });

  it('parses HTTP-date Retry-After values and caps excessive server-directed waits', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const retryAt = new Date(now + 3_000).toUTCString();

    expect(
      getEnsemblContractRetryDelay(
        axiosFailure({ status: 429, headers: { 'retry-after': retryAt } }),
        now,
      ),
    ).toBe(3_000);
    expect(
      getEnsemblContractRetryDelay(axiosFailure({ status: 429, headers: { 'retry-after': '30' } })),
    ).toBe(10_000);
  });

  it('does not retry ordinary HTTP 4xx responses or non-Axios errors', async () => {
    const clientError = axiosFailure({ status: 404 });
    const assertionError = new Error('schema changed');

    expect(shouldRetryEnsemblContractRequest(clientError)).toBe(false);
    expect(shouldRetryEnsemblContractRequest(assertionError)).toBe(false);

    for (const failure of [clientError, assertionError]) {
      const request = vi.fn().mockRejectedValue(failure);
      await expect(retryEnsemblContractRequest(request)).rejects.toBe(failure);
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it('rethrows the final failure after exactly two retryable attempts', async () => {
    const firstFailure = axiosFailure({ code: 'ETIMEDOUT' });
    const finalFailure = axiosFailure({ status: 503 });
    const request = vi.fn().mockRejectedValueOnce(firstFailure).mockRejectedValueOnce(finalFailure);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(retryEnsemblContractRequest(request, { sleep })).rejects.toBe(finalFailure);
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
