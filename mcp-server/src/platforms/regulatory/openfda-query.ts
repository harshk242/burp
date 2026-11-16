import { getClients } from './client.js';
import type { LabelRecord, OpenFdaResponse } from './types.js';

export type OpenFdaEndpoint = 'drugsfda' | 'label';

export interface OpenFdaPage<T> {
  results: T[];
  total: number;
  lastUpdated: string | null;
}

/** Quote a user term for an openFDA phrase query; quotes and backslashes cannot be escaped there. */
export function phrase(term: string): string {
  const clean = term.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('search term is empty');
  return `"${clean}"`;
}

/**
 * Bare numbers try every application type. Drugs@FDA zero-pads to six digits (NDA021588).
 */
export function applicationNumbers(input: string): string[] {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  const match = /^(NDA|BLA|ANDA)?(\d{4,6})$/.exec(compact);
  if (!match) throw new Error('application_number must look like NDA021588, BLA761440, ANDA204285 or a bare 6-digit number');
  const digits = match[2]!.padStart(6, '0');
  return (match[1] ? [match[1]] : ['NDA', 'BLA', 'ANDA']).map((type) => type + digits);
}

export const anyOf = (field: string, values: string[]) => `${field}:(${values.join(' OR ')})`;

export function drugNameQuery(drug: string): string {
  const term = phrase(drug);
  return '(' + ['openfda.brand_name', 'openfda.generic_name', 'openfda.substance_name', 'products.brand_name', 'products.active_ingredients.name']
    .map((field) => `${field}:${term}`).join(' OR ') + ')';
}

export function labelNameQuery(drug: string): string {
  const term = phrase(drug);
  return '(' + ['openfda.brand_name', 'openfda.generic_name', 'openfda.substance_name']
    .map((field) => `${field}:${term}`).join(' OR ') + ')';
}

/** `20251023` → `2025-10-23`. */
export function isoDate(value: string | undefined): string | null {
  return value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
}

export async function openFdaGet<T>(
  endpoint: OpenFdaEndpoint,
  search: string,
  options: { limit: number; sort?: string },
): Promise<OpenFdaPage<T>> {
  const { openFda, openFdaApiKey } = getClients();
  const response = await openFda.get<OpenFdaResponse<T>>(`/drug/${endpoint}.json`, {
    params: {
      search,
      limit: options.limit,
      ...(options.sort ? { sort: options.sort } : {}),
      ...(openFdaApiKey ? { api_key: openFdaApiKey } : {}),
    },
  });
  const body = response.data;
  if (response.status === 404) {
    if (body?.error?.code === 'NOT_FOUND') return { results: [], total: 0, lastUpdated: null };
    throw new Error(`openFDA ${endpoint} returned HTTP 404: ${body?.error?.message ?? 'unknown route'}`);
  }
  if (body?.error) throw new Error(`openFDA ${endpoint} error: ${body.error.message ?? body.error.code ?? 'unknown'}`);
  const results = body?.results ?? [];
  return {
    results,
    total: body?.meta?.results?.total ?? results.length,
    lastUpdated: body?.meta?.last_updated ?? null,
  };
}

/** Joined text of one label section, without the leading "1 INDICATIONS AND USAGE" heading. */
export function sectionText(label: LabelRecord, section: string): string | null {
  const value = label[section];
  if (!Array.isArray(value)) return null;
  const text = value.filter((part): part is string => typeof part === 'string').join(' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function excerpt(text: string, term: string | undefined, width = 400): string {
  const body = text.replace(/^\d*\s*INDICATIONS (AND|&) USAGE\s*/i, '');
  const at = term ? body.toLowerCase().indexOf(term.toLowerCase()) : -1;
  const start = at > width / 2 ? at - Math.floor(width / 2) : 0;
  const slice = body.slice(start, start + width);
  return (start > 0 ? '…' : '') + slice + (start + width < body.length ? '…' : '');
}

export const dailyMedUrl = (setId: string | undefined) =>
  setId ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${setId}` : null;
