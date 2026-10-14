export interface SchemaNode {
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'union' | 'unknown';
  path: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode | null;
  variants?: SchemaNode[];
  optional?: boolean;
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

export function getVariants(node: SchemaNode): SchemaNode[] {
  return node.type === 'union' ? (node.variants ?? []) : [node];
}

