import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expect } from 'vitest';

export interface SchemaNode {
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'union' | 'unknown';
  path: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode | null;
  variants?: SchemaNode[];
  optional?: boolean;
}

export interface SchemaDiff {
  removedKeys: string[];
  typeChanges: string[];
  addedKeys: string[];
}

const MAX_SAMPLE_ITEMS = 5;

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

function mergeItemSchemas(items: unknown[], arrayPath: string): SchemaNode {
  const sample = items.slice(0, MAX_SAMPLE_ITEMS);
  const schemas = sample.map((item) => extractSchema(item, `${arrayPath}[]`));
  return schemas.reduce((merged, next) => mergeNodes(merged, next));
}

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
        const mergedChild = mergeNodes(aProps[key], bProps[key]);
        if (aProps[key].optional || bProps[key].optional) {
          merged[key] = { ...mergedChild, optional: true };
        } else {
          merged[key] = mergedChild;
        }
      } else if (key in aProps) {
        merged[key] = { ...aProps[key], optional: true };
      } else {
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

  return a;
}

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

export interface CompareOptions {
  nullablePaths?: ReadonlySet<string>;
}

interface CompareContext {
  removedKeys: string[];
  typeChanges: string[];
  addedKeys: string[];
  nullablePaths: ReadonlySet<string>;
}

export function compareSchemas(
  baseline: SchemaNode,
  current: SchemaNode,
  options: CompareOptions = {},
): SchemaDiff {
  const ctx: CompareContext = {
    removedKeys: [],
    typeChanges: [],
    addedKeys: [],
    nullablePaths: options.nullablePaths ?? new Set(),
  };

  compareNodes(baseline, current, ctx);

  return { removedKeys: ctx.removedKeys, typeChanges: ctx.typeChanges, addedKeys: ctx.addedKeys };
}

function isToleratedNull(path: string, baselineType: string, currentType: string, ctx: CompareContext): boolean {
  return (baselineType === 'null' || currentType === 'null') && ctx.nullablePaths.has(path);
}

function compareNodes(baseline: SchemaNode, current: SchemaNode, ctx: CompareContext): void {
  if (baseline.type === 'union') {
    compareUnionBaseline(baseline, current, ctx);
    return;
  }

  if (current.type === 'union') {
    compareUnionCurrent(baseline, current, ctx);
    return;
  }

  if (baseline.type !== current.type) {
    if (!isToleratedNull(baseline.path, baseline.type, current.type, ctx)) {
      ctx.typeChanges.push(`${baseline.path}: was '${baseline.type}', now '${current.type}'`);
    }
    return;
  }

  if (baseline.type === 'object' && current.type === 'object') {
    const baseProps = baseline.properties ?? {};
    const currProps = current.properties ?? {};

    for (const key of Object.keys(baseProps)) {
      if (!(key in currProps)) {
        if (!baseProps[key].optional) {
          ctx.removedKeys.push(`${baseline.path}.${key}`);
        }
      } else {
        compareNodes(baseProps[key], currProps[key], ctx);
      }
    }

    for (const key of Object.keys(currProps)) {
      if (!(key in baseProps)) {
        ctx.addedKeys.push(`${current.path}.${key}`);
      }
    }
  }

  if (baseline.type === 'array' && current.type === 'array') {
    if (baseline.items && current.items) {
      compareNodes(baseline.items, current.items, ctx);
    }
  }
}

function compareUnionBaseline(baseline: SchemaNode, current: SchemaNode, ctx: CompareContext): void {
  for (const currentVariant of getVariants(current)) {
    const baselineVariant = getVariants(baseline)
      .find((variant) => variant.type === currentVariant.type);

    if (!baselineVariant) {
      if (!isToleratedNull(baseline.path, 'union', currentVariant.type, ctx)) {
        ctx.typeChanges.push(
          `${baseline.path}: was one of ${describeVariants(baseline)}, now '${currentVariant.type}'`,
        );
      }
    } else {
      compareNodes(baselineVariant, currentVariant, ctx);
    }
  }
}

function compareUnionCurrent(baseline: SchemaNode, current: SchemaNode, ctx: CompareContext): void {
  for (const currentVariant of getVariants(current)) {
    if (currentVariant.type !== baseline.type) {
      if (!isToleratedNull(baseline.path, baseline.type, currentVariant.type, ctx)) {
        ctx.typeChanges.push(
          `${baseline.path}: was '${baseline.type}', now '${currentVariant.type}'`,
        );
      }
    } else {
      compareNodes(baseline, currentVariant, ctx);
    }
  }
}

function describeVariants(node: SchemaNode): string {
  return getVariants(node).map((variant) => `'${variant.type}'`).join(' | ');
}

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

export async function assertSchemaStable(
  fixtureName: string,
  data: unknown,
  options: CompareOptions = {},
): Promise<void> {
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

  const diff = compareSchemas(loadFixture(fixtureName), current, options);

  if (diff.addedKeys.length > 0) {
    console.warn(`[DRIFT WARNING] New keys in ${fixtureName}: ${diff.addedKeys.join(', ')}`);
  }
  expect(diff.removedKeys, `Removed keys in ${fixtureName}`).toEqual([]);
  expect(diff.typeChanges, `Type changes in ${fixtureName}`).toEqual([]);
}
