import { APIError } from '../../shared/exceptions.js';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new APIError('Invalid ClinPGx response: expected a record');
  }
  return value as Record<string, unknown>;
}

export function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') throw new APIError('Invalid ClinPGx text field');
  return String(value);
}

export function required(value: unknown, field: string): string {
  const result = text(value);
  if (!result?.trim()) throw new APIError(`Invalid ClinPGx response: missing ${field}`);
  return result;
}

export function flag(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new APIError('Invalid ClinPGx boolean field');
  return value;
}

export function texts(value: unknown): string[] {
  return list(value).map(item => required(item, 'array item'));
}

export function names(value: unknown, key: string): string[] {
  return list(value).map(item => required(record(item)[key], key));
}

export function child(value: unknown): Record<string, unknown> {
  return value === undefined || value === null ? {} : record(value);
}

export function decodeEnvelope(value: unknown): { data: unknown; total?: number } {
  const envelope = record(value);
  if (!Object.hasOwn(envelope, 'data')) throw new APIError('Invalid ClinPGx response: missing data');
  if (envelope.total !== undefined && (typeof envelope.total !== 'number' || !Number.isInteger(envelope.total) || envelope.total < 0)) {
    throw new APIError('Invalid ClinPGx response: invalid total');
  }
  return { data: envelope.data, total: envelope.total as number | undefined };
}
