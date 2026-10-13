/**
 * Canonical JSON + sha256, shared by sync.ts and (Phase 2) the experiment runner.
 *
 * Canonical form: object keys sorted, no whitespace, `undefined` dropped (object
 * members) and `null` kept. Arrays keep their order; `undefined` array elements
 * become `null`, as in JSON.stringify. Non-finite numbers are rejected rather than
 * silently turned into `null`.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => (v === undefined ? "null" : encode(v, `${path}[${i}]`))).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(`canonicalJson: unsupported object at ${path}`);
      }
      const record = value as Record<string, unknown>;
      const members = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${encode(record[k], `${path}.${k}`)}`);
      return `{${members.join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface HashableItem {
  input: unknown;
  expected_output: unknown;
  metadata: Record<string, unknown> | null | undefined;
}

/** sha256 of `{ input, expected_output, metadata minus content_hash }`. */
export function contentHash(item: HashableItem): string {
  const { content_hash: _ignored, ...metadata } = item.metadata ?? {};
  return sha256Hex(canonicalJson({ input: item.input, expected_output: item.expected_output, metadata }));
}

/** sha256 of the `(id, content_hash)` pairs sorted by id. */
export function datasetHash(pairs: ReadonlyArray<{ id: string; contentHash: string }>): string {
  const sorted = [...pairs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sha256Hex(canonicalJson(sorted.map((p) => [p.id, p.contentHash])));
}
