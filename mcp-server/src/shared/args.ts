/**
 * Readers for MCP tool arguments. `args` arrives as `Record<string, unknown>` from the client, so each
 * handler reads its parameters through these instead of casting. An absent optional parameter is
 * `undefined`; a parameter of the wrong type is a `ValidationError` naming it.
 */

import { ValidationError } from './exceptions.js';

type Args = Record<string, unknown>;

function invalid(key: string, expected: string): ValidationError {
  return new ValidationError(`Invalid argument "${key}": expected ${expected}`);
}

/** A non-empty string parameter. */
export function requireString(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw invalid(key, 'a non-empty string');
  return value;
}

export function optionalString(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(key, 'a string');
  return value;
}

/** A number parameter; numeric strings (`"10"`) are accepted, since model clients send them. */
export function optionalNumber(args: Args, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  throw invalid(key, 'a number');
}

export function requireNumber(args: Args, key: string): number {
  const value = optionalNumber(args, key);
  if (value === undefined) throw invalid(key, 'a number');
  return value;
}

/** A boolean parameter; `"true"` / `"false"` are accepted, since model clients send them. */
export function optionalBoolean(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw invalid(key, 'a boolean');
}

export function optionalStringArray(args: Args, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw invalid(key, 'an array of strings');
  }
  return value;
}

export function requireStringArray(args: Args, key: string): string[] {
  const value = optionalStringArray(args, key);
  if (value === undefined) throw invalid(key, 'an array of strings');
  return value;
}

/** A string parameter restricted to `allowed`. */
export function optionalEnum<const T extends string>(args: Args, key: string, allowed: readonly T[]): T | undefined {
  const value = optionalString(args, key);
  if (value === undefined) return undefined;
  const match = allowed.find((option) => option === value);
  if (match === undefined) throw invalid(key, `one of ${allowed.join(', ')}`);
  return match;
}
