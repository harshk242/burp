/**
 * Narrowing for untyped data at a boundary (`JSON.parse`, `res.json()`, YAML, SSE payloads,
 * `catch (e)` values): the value arrives as `unknown` and is checked here instead of cast.
 */

export type JsonRecord = Record<string, unknown>;

/** A plain object (not an array, not null). */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value as an object, or `{}` when it is not one. */
export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function optString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The string elements of an array; other elements and non-arrays are dropped. */
export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The `code` field of a thrown value (Node `ErrnoException`, SQLite errors), when it has one. */
export function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : undefined;
}

/** The message of a thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
