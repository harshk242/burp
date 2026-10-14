import { XMLParseError } from './exceptions.js';
export type XmlValue = string | number | boolean | XmlNode | XmlValue[];
export interface XmlNode { [key: string]: XmlValue }
export function decodeXml(value: unknown): XmlValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(decodeXml);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decodeXml(child)]));
  throw new XMLParseError('Invalid XML node');
}
export function node(value: XmlValue | undefined): XmlNode {
  if (value === undefined || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new XMLParseError('Expected XML element');
  return value;
}
export function at(value: XmlValue | undefined, ...keys: string[]): XmlValue | undefined {
  for (const key of keys) value = node(value)[key];
  return value;
}
export function many(value: XmlValue | undefined): XmlValue[] {
  return value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value];
}
export function text(value: XmlValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'object') return Array.isArray(value) ? text(value[0]) : text(value['#text']);
  return String(value);
}
export function required(value: XmlValue | undefined, field: string): string {
  const result = text(value);
  if (!result.trim()) throw new XMLParseError(`Invalid XML record: missing ${field}`);
  return result;
}
export function integer(value: XmlValue | undefined, field: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const source = required(value, field);
  if (!/^\d+$/.test(source) || !Number.isSafeInteger(Number(source))) throw new XMLParseError(`Invalid XML integer: ${field}`);
  return Number(source);
}
