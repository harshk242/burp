/**
 * Readers for untyped upstream data (axios `response.data`, `JSON.parse`, fast-xml-parser output).
 *
 * Upstream biology APIs are typed at this boundary: the value arrives as `unknown`, and each field the
 * platform reads is narrowed here. A field with the wrong type reads as absent (`undefined`, `[]` or
 * `{}`), matching how the handlers already treat a missing field.
 */

export type JsonRecord = Record<string, unknown>;

/** A plain object (not an array, not null). */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value as an object, or `{}` when it is not one. */
export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

/** The value as an object, or `undefined` when it is not one. */
export function optRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

/** The value as an array, or `[]` when it is not one. */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The object elements of an array; other elements and non-arrays are dropped. */
export function recordArray(value: unknown): JsonRecord[] {
  return asArray(value).filter(isRecord);
}

/** The string elements of an array; other elements and non-arrays are dropped. */
export function stringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

/** The number elements of an array; other elements and non-arrays are dropped. */
export function numberArray(value: unknown): number[] {
  return asArray(value).filter((item): item is number => typeof item === 'number');
}

/**
 * A child that may occur once or repeat (fast-xml-parser yields an object or an array):
 * always an array of the object occurrences.
 */
export function recordList(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : isRecord(value) ? [value] : [];
}

export function optString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function optNumber(value: unknown): number | undefined {
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
}

export function optBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** A string or a number as text (XML attributes and some JSON ids come back as either). */
export function optText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && !Number.isNaN(value)) return String(value);
  return undefined;
}

/** A number, or a numeric string as a number (ChEMBL serializes many properties as strings). */
export function optNumeric(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** Walk nested objects: `path(data, 'a', 'b')` is `data.a.b`, or `undefined` if any step is not an object. */
export function path(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** The thrown value as an object, for reading fields such as `code` or `response`. */
export function errorRecord(error: unknown): JsonRecord {
  return asRecord(error);
}
