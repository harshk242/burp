import axios, { type AxiosInstance } from 'axios';

let client: AxiosInstance | null = null;

/**
 * Initialise (or re-initialise) the Reactome Content Service API client.
 * Called once from the platform module's `init()`.
 */
export function initClient(_env: Record<string, string | undefined>): void {
  client = axios.create({
    baseURL: 'https://reactome.org/ContentService',
    timeout: 30_000,
    headers: {
      'User-Agent': 'Reactome-MCP-Server/1.0.0',
      'Content-Type': 'application/json',
    },
  });
}

/** Return the shared Axios instance. Throws if called before `initClient`. */
export function getClient(): AxiosInstance {
  if (!client) {
    throw new Error('Reactome API client not initialised – call initClient() first');
  }
  return client;
}

/** Tear down the client (cancel pending requests, release references). */
export function cleanupClient(): void {
  client = null;
}
