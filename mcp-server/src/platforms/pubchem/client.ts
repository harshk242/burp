import axios, { type AxiosInstance } from 'axios';
import { PUBCHEM_PUG_REST_BASE_URL } from './endpoints.js';

let client: AxiosInstance | null = null;

/**
 * Initialise (or re-initialise) the PubChem PUG REST API client.
 * Called once from the platform module's `init()`.
 */
export function initClient(_env: Record<string, string | undefined>): void {
  client = axios.create({
    baseURL: PUBCHEM_PUG_REST_BASE_URL,
    timeout: 30_000,
    headers: {
      'User-Agent': 'PubChem-MCP-Server/1.0.0',
      Accept: 'application/json',
    },
  });
}

/** Return the shared Axios instance. Throws if called before `initClient`. */
export function getClient(): AxiosInstance {
  if (!client) {
    throw new Error('PubChem API client not initialised – call initClient() first');
  }
  return client;
}

/** Tear down the client (cancel pending requests, release references). */
export function cleanupClient(): void {
  client = null;
}
