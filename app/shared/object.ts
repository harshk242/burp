/** Keys of T whose value type admits undefined. */
type UndefinedKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];

/** T with every undefined-admitting key made optional and stripped of `undefined`. */
export type OmitUndefined<T> = Omit<T, UndefinedKeys<T>> & { [K in UndefinedKeys<T>]?: Exclude<T[K], undefined> };

/**
 * Drops undefined-valued keys. Under exactOptionalPropertyTypes an optional property
 * (`{ apiKey?: string }`) accepts a missing key but not `apiKey: undefined`, so option bags
 * built from possibly-undefined values go through this before reaching third-party APIs.
 */
export function omitUndefined<T extends object>(value: T): OmitUndefined<T>;
// The overload states the mapped type, which `Object.fromEntries` cannot express; the body only drops keys.
export function omitUndefined(value: object): object {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

/**
 * A string record with undefined-valued keys dropped, e.g. `process.env` merged with
 * overrides for a child process (`Record<string, string>` expected).
 */
export function definedEntries(value: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined) result[key] = v;
  }
  return result;
}
