import { XMLParser } from 'fast-xml-parser';
import { expect } from 'vitest';
import { pace } from './tool-requests.js';

export interface NcbiField { name: string; fullname: string }
export const tags = (term: string) => [...term.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].toLowerCase());
export function ncbiFields(fields: NcbiField[], aliases: Record<string, string> = {}) {
  const canonicalField = (tag: string): string | undefined => {
    const name = aliases[tag.toLowerCase()] ?? tag.toLowerCase();
    return fields.find(f => [f.name, f.fullname].some(s => s.toLowerCase() === name))?.name.toLowerCase();
  };
  const assertFieldTags = (term: string) => {
    for (const tag of tags(term)) expect(canonicalField(tag), tag).toBeDefined();
  };
  const assertSearchAccepted = (xml: string, term: string, forbidAllFields = false) => {
    const result = new XMLParser().parse(xml).eSearchResult;
    expect(result).toBeDefined();
    for (const key of ['ERROR', 'ErrorList', 'WarningList', 'errorlist', 'warninglist']) {
      expect(result[key], key).toBeUndefined();
    }
    const translation = String(result.QueryTranslation ?? '');
    const translated = tags(translation);
    if (forbidAllFields && tags(term).length) expect(translated).not.toContain('all fields');
    for (const tag of tags(term)) {
      expect(canonicalField(tag), tag).toBeDefined();
      expect(translated.map(canonicalField), translation).toContain(canonicalField(tag));
    }
    return result;
  };
  return { canonicalField, assertFieldTags, assertSearchAccepted };
}
export function assertNcbiFieldsMatch(live: NcbiField[], saved: NcbiField[]) {
  const canonical = (fields: NcbiField[]) => fields.map(({ name, fullname }) => JSON.stringify({ name, fullname })).sort();
  expect(canonical(live)).toEqual(canonical(saved));
}
export const ncbiDelay = () => process.env.NCBI_API_KEY ? 110 : 350;
export const paceNcbi = () => pace(ncbiDelay());
