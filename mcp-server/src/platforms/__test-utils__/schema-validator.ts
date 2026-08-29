/**
 * Schema-based API contract validation utilities.
 *
 * Snapshots the *structure* (type + key presence) of an API response, not the
 * values. This naturally handles volatile fields (timestamps, counts, IDs) —
 * they always have a stable type even when their values change.
 *
 * Drift semantics:
 *   removed key → ERROR   (handler may depend on it)
 *   type changed → ERROR  (silent breakage — e.g. string → number)
 *   added key   → WARNING (non-breaking, logged but test passes)
 *
 * Array sampling:
 *   Up to MAX_SAMPLE_ITEMS elements are inspected and their schemas are merged.
 *   Keys present in only some items are marked optional in the merged schema.
 *   Optional keys in the baseline are not flagged as errors if absent in a later
 *   snapshot — preventing false positives from naturally sparse paginated data.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expect } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SchemaNode {
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'union' | 'unknown';
  path: string;
  properties?: Record<string, SchemaNode>; // present when type === 'object'
  items?: SchemaNode | null;               // present when type === 'array'; null if empty array
  variants?: SchemaNode[];                 // present when type === 'union'
  optional?: boolean;
}

export interface SchemaDiff {
  removedKeys: string[];
  typeChanges: string[];
  addedKeys: string[];
}

// ── Schema extraction ─────────────────────────────────────────────────────────

/** Maximum number of array elements sampled when extracting a schema. */
const MAX_SAMPLE_ITEMS = 5;

/**
 * Recursively walk a JSON value and produce a structural SchemaNode.
 * For arrays, up to MAX_SAMPLE_ITEMS elements are sampled and their schemas
 * are merged so that keys present in any element are captured.
 */
export function extractSchema(value: unknown, path = '$'): SchemaNode {
  if (value === null) return { type: 'null', path };

  if (Array.isArray(value)) {
    return {
      type: 'array',
      path,
      items: value.length > 0 ? mergeItemSchemas(value, path) : null,
    };
  }

  if (typeof value === 'object') {
    const node: SchemaNode = { type: 'object', path, properties: {} };
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      node.properties![k] = extractSchema(v, `${path}.${k}`);
    }
    return node;
  }

  if (typeof value === 'string') return { type: 'string', path };
  if (typeof value === 'number') return { type: 'number', path };
  if (typeof value === 'boolean') return { type: 'boolean', path };
  return { type: 'unknown', path };
}

/**
 * Extract and merge schemas for up to MAX_SAMPLE_ITEMS elements of an array.
 * Keys that appear in only some elements are marked `optional: true` in the
 * resulting merged schema.
 */
function mergeItemSchemas(items: unknown[], arrayPath: string): SchemaNode {
  const sample = items.slice(0, MAX_SAMPLE_ITEMS);
  const schemas = sample.map((item) => extractSchema(item, `${arrayPath}[]`));
  // Array.reduce on a single-element array returns that element without calling
  // the reducer, so this is safe for length === 1.
  return schemas.reduce((merged, next) => mergeNodes(merged, next));
}

/**
 * Merge two SchemaNodes produced from different elements of the same array.
 * - Same type, both objects: union their properties; keys missing from either
 *   side are marked optional.
 * - Same type, both arrays: recurse into items.
 * - Same primitive type: return node `a` unchanged.
 * - Mismatched types: retain every observed type as an explicit union.
 */
function mergeNodes(a: SchemaNode, b: SchemaNode): SchemaNode {
  if (a.type === 'union' || b.type === 'union') {
    return mergeUnionNodes(a, b);
  }

  if (a.type !== b.type) {
    return { type: 'union', path: a.path, variants: [a, b] };
  }

  if (a.type === 'object' && b.type === 'object') {
    const aProps = a.properties ?? {};
    const bProps = b.properties ?? {};
    const merged: Record<string, SchemaNode> = {};
    const allKeys = new Set([...Object.keys(aProps), ...Object.keys(bProps)]);

    for (const key of allKeys) {
      if (key in aProps && key in bProps) {
        // Present in both — recurse, preserve optional if either side says so
        const mergedChild = mergeNodes(aProps[key], bProps[key]);
        if (aProps[key].optional || bProps[key].optional) {
          merged[key] = { ...mergedChild, optional: true };
        } else {
          merged[key] = mergedChild;
        }
      } else if (key in aProps) {
        // Only in `a` — missing from `b`, so it's optional
        merged[key] = { ...aProps[key], optional: true };
      } else {
        // Only in `b` — missing from `a`, so it's optional
        merged[key] = { ...bProps[key], optional: true };
      }
    }

    return { type: 'object', path: a.path, properties: merged };
  }

  if (a.type === 'array' && b.type === 'array') {
    const items =
      a.items && b.items ? mergeNodes(a.items, b.items) : (a.items ?? b.items ?? null);
    return { type: 'array', path: a.path, items };
  }

  // Primitive with same type — nothing to merge
  return a;
}

/**
 * Flatten and normalize a union. Variants of the same type are merged so an
 * object or array alternative retains its nested structural contract.
 */
function mergeUnionNodes(a: SchemaNode, b: SchemaNode): SchemaNode {
  const variants = [...getVariants(a), ...getVariants(b)];
  const merged: SchemaNode[] = [];

  for (const variant of variants) {
    const matchingIndex = merged.findIndex((candidate) => candidate.type === variant.type);
    if (matchingIndex === -1) {
      merged.push(variant);
    } else {
      merged[matchingIndex] = mergeNodes(merged[matchingIndex], variant);
    }
  }

  return { type: 'union', path: a.path, variants: merged };
}

function getVariants(node: SchemaNode): SchemaNode[] {
  return node.type === 'union' ? (node.variants ?? []) : [node];
}

// ── Schema comparison ─────────────────────────────────────────────────────────

/**
 * Compare a baseline schema against a current schema.
 * Returns lists of removed keys, type changes, and newly added keys.
 *
 * A key that is marked `optional` in the baseline is allowed to be absent in
 * the current snapshot without triggering a "removed key" error.
 */
export function compareSchemas(baseline: SchemaNode, current: SchemaNode): SchemaDiff {
  const removedKeys: string[] = [];
  const typeChanges: string[] = [];
  const addedKeys: string[] = [];

  compareNodes(baseline, current, removedKeys, typeChanges, addedKeys);

  return { removedKeys, typeChanges, addedKeys };
}

function compareNodes(
  baseline: SchemaNode,
  current: SchemaNode,
  removedKeys: string[],
  typeChanges: string[],
  addedKeys: string[],
): void {
  if (baseline.type === 'union') {
    compareUnionBaseline(baseline, current, removedKeys, typeChanges, addedKeys);
    return;
  }

  if (current.type === 'union') {
    compareUnionCurrent(baseline, current, removedKeys, typeChanges, addedKeys);
    return;
  }

  if (baseline.type !== current.type) {
    typeChanges.push(`${baseline.path}: was '${baseline.type}', now '${current.type}'`);
    return;
  }

  if (baseline.type === 'object' && current.type === 'object') {
    const baseProps = baseline.properties ?? {};
    const currProps = current.properties ?? {};

    for (const key of Object.keys(baseProps)) {
      if (!(key in currProps)) {
        // Only flag as removed if the baseline considered the key required.
        if (!baseProps[key].optional) {
          removedKeys.push(`${baseline.path}.${key}`);
        }
      } else {
        compareNodes(baseProps[key], currProps[key], removedKeys, typeChanges, addedKeys);
      }
    }

    for (const key of Object.keys(currProps)) {
      if (!(key in baseProps)) {
        addedKeys.push(`${current.path}.${key}`);
      }
    }
  }

  if (baseline.type === 'array' && current.type === 'array') {
    if (baseline.items && current.items) {
      compareNodes(baseline.items, current.items, removedKeys, typeChanges, addedKeys);
    }
  }
}

function compareUnionBaseline(
  baseline: SchemaNode,
  current: SchemaNode,
  removedKeys: string[],
  typeChanges: string[],
  addedKeys: string[],
): void {
  for (const currentVariant of getVariants(current)) {
    const baselineVariant = getVariants(baseline)
      .find((variant) => variant.type === currentVariant.type);

    if (!baselineVariant) {
      typeChanges.push(
        `${baseline.path}: was one of ${describeVariants(baseline)}, now '${currentVariant.type}'`,
      );
    } else {
      compareNodes(baselineVariant, currentVariant, removedKeys, typeChanges, addedKeys);
    }
  }
}

function compareUnionCurrent(
  baseline: SchemaNode,
  current: SchemaNode,
  removedKeys: string[],
  typeChanges: string[],
  addedKeys: string[],
): void {
  for (const currentVariant of getVariants(current)) {
    if (currentVariant.type !== baseline.type) {
      typeChanges.push(
        `${baseline.path}: was '${baseline.type}', now '${currentVariant.type}'`,
      );
    } else {
      compareNodes(baseline, currentVariant, removedKeys, typeChanges, addedKeys);
    }
  }
}

function describeVariants(node: SchemaNode): string {
  return getVariants(node).map((variant) => `'${variant.type}'`).join(' | ');
}

// ── Fixture I/O ───────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

export function fixtureExists(fixturePath: string): boolean {
  return fs.existsSync(path.join(FIXTURES_DIR, fixturePath));
}

export function loadFixture(fixturePath: string): SchemaNode {
  const fullPath = path.join(FIXTURES_DIR, fixturePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Fixture not found: ${fullPath}\n` +
        'Run: bun run scripts/capture-api-snapshots.ts\n' +
        'Or:  UPDATE_SNAPSHOTS=true bun run --filter bio-mcp-unified test:contracts',
    );
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as SchemaNode;
}

export function saveFixture(fixturePath: string, schema: SchemaNode): void {
  const fullPath = path.join(FIXTURES_DIR, fixturePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, JSON.stringify(schema, null, 2) + '\n');
}

// ── Contract assertion helper ─────────────────────────────────────────────────

/**
 * Assert that a live API response matches a committed schema fixture.
 *
 * Behaviour:
 *   UPDATE_SNAPSHOTS=true  → overwrite fixture with current schema and pass.
 *   fixture missing        → FAIL with a clear message (not auto-create).
 *                            Run UPDATE_SNAPSHOTS=true once to seed the fixture.
 *   fixture present        → compare; fail on removed keys or type changes.
 *
 * The "fail on missing" rule is intentional: a renamed, deleted, or
 * never-committed fixture must not silently become a no-op test.
 */
export async function assertSchemaStable(fixtureName: string, data: unknown): Promise<void> {
  const UPDATE = process.env.UPDATE_SNAPSHOTS === 'true';
  const current = extractSchema(data);

  if (UPDATE) {
    saveFixture(fixtureName, current);
    console.log(`[SNAPSHOT] Updated fixture: ${fixtureName}`);
    return;
  }

  if (!fixtureExists(fixtureName)) {
    throw new Error(
      `[CONTRACT] Fixture missing: ${fixtureName}\n` +
        'Seed it by running:\n' +
        '  UPDATE_SNAPSHOTS=true npx vitest run --config vitest.contracts.config.ts',
    );
  }

  const diff = compareSchemas(loadFixture(fixtureName), current);

  if (diff.addedKeys.length > 0) {
    console.warn(`[DRIFT WARNING] New keys in ${fixtureName}: ${diff.addedKeys.join(', ')}`);
  }
  expect(diff.removedKeys, `Removed keys in ${fixtureName}`).toEqual([]);
  expect(diff.typeChanges, `Type changes in ${fixtureName}`).toEqual([]);
}
