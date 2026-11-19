import { isRecord } from './json.js';

interface SchemaNodeBase {
  path: string;
  optional?: boolean;
}

export type SchemaNode = SchemaNodeBase & (
  | { type: 'object'; properties: Record<string, SchemaNode>; items?: never; variants?: never }
  | { type: 'array'; items: SchemaNode | null; properties?: never; variants?: never }
  | { type: 'union'; variants: SchemaNode[]; properties?: never; items?: never }
  | { type: 'string' | 'number' | 'boolean' | 'null' | 'unknown'; properties?: never; items?: never; variants?: never }
);

const MAX_SAMPLE_ITEMS = 5;

export function extractSchema(value: unknown, path = '$'): SchemaNode {
  if (value === null) return { type: 'null', path };

  if (Array.isArray(value)) {
    return {
      type: 'array',
      path,
      items: mergeItemSchemas(value, path),
    };
  }

  if (isRecord(value)) {
    const node: SchemaNode = { type: 'object', path, properties: {} };
    for (const [k, v] of Object.entries(value)) {
      node.properties[k] = extractSchema(v, `${path}.${k}`);
    }
    return node;
  }

  if (typeof value === 'string') return { type: 'string', path };
  if (typeof value === 'number') return { type: 'number', path };
  if (typeof value === 'boolean') return { type: 'boolean', path };
  return { type: 'unknown', path };
}

function mergeItemSchemas(items: unknown[], arrayPath: string): SchemaNode | null {
  if (items.length === 0) return null;
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
    const aProps = a.properties;
    const bProps = b.properties;
    const merged: Record<string, SchemaNode> = {};
    const allKeys = new Set([...Object.keys(aProps), ...Object.keys(bProps)]);

    for (const key of allKeys) {
      const aChild = aProps[key];
      const bChild = bProps[key];
      if (aChild && bChild) {
        const mergedChild = mergeNodes(aChild, bChild);
        merged[key] = aChild.optional || bChild.optional ? { ...mergedChild, optional: true } : mergedChild;
      } else {
        const only = aChild ?? bChild;
        if (only) merged[key] = { ...only, optional: true };
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
    const match = merged[matchingIndex];
    if (match === undefined) {
      merged.push(variant);
    } else {
      merged[matchingIndex] = mergeNodes(match, variant);
    }
  }

  return { type: 'union', path: a.path, variants: merged };
}

export function getVariants(node: SchemaNode): SchemaNode[] {
  return node.type === 'union' ? node.variants : [node];
}

