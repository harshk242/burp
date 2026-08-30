import axios from 'axios';

const FALLBACK_BACKOFF_MS = 500;
const MAX_RETRY_AFTER_MS = 10_000;

type Sleep = (milliseconds: number) => Promise<void>;

export interface EnsemblContractRetryOptions {
  sleep?: Sleep;
  now?: () => number;
}

/**
 * Returns whether an Axios error is a transient Ensembl REST failure worth one
 * additional request. Non-Axios failures, including schema assertions, are
 * deliberately excluded so contract drift remains immediately visible.
 */
export function shouldRetryEnsemblContractRequest(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;

  if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code ?? '')) {
    return true;
  }

  if (!error.response && (error.code === 'ERR_NETWORK' || error.message === 'Network Error')) {
    return true;
  }

  const status = error.response?.status;
  return status === 408 || status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

/**
 * Gets the delay before the only retry. Retry-After is honored for rate limits
 * when valid, but server-directed waits are capped at 10 seconds so a public
 * API response cannot leave a contract test sleeping indefinitely.
 */
export function getEnsemblContractRetryDelay(error: unknown, now = Date.now()): number {
  if (!axios.isAxiosError(error) || error.response?.status !== 429) {
    return FALLBACK_BACKOFF_MS;
  }

  const retryAfter = getRetryAfterHeader(error.response.headers);
  const delay = parseRetryAfter(retryAfter, now);
  return delay === undefined ? FALLBACK_BACKOFF_MS : Math.min(delay, MAX_RETRY_AFTER_MS);
}

/** Runs a request at most twice, retrying only a classified transport failure. */
export async function retryEnsemblContractRequest<T>(
  request: () => Promise<T>,
  { sleep = defaultSleep, now = Date.now }: EnsemblContractRetryOptions = {},
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!shouldRetryEnsemblContractRequest(error)) throw error;

    await sleep(getEnsemblContractRetryDelay(error, now()));
    return request();
  }
}

function getRetryAfterHeader(headers: unknown): unknown {
  if (!headers || typeof headers !== 'object') return undefined;

  const maybeHeaders = headers as Record<string, unknown> & {
    get?: (name: string) => unknown;
  };
  return (
    maybeHeaders.get?.('retry-after') ??
    maybeHeaders['retry-after'] ??
    maybeHeaders['Retry-After']
  );
}

function parseRetryAfter(value: unknown, now: number): number | undefined {
  if (typeof value !== 'string') return undefined;

  if (/^\s*\d+(?:\.\d+)?\s*$/.test(value)) {
    return Number(value) * 1_000;
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
