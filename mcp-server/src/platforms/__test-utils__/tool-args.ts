/**
 * Builds tool arguments straight from the published input schemas, so tests
 * exercise every argument a model can send — not only the ones a test author
 * remembered. Shared by the offline unit test and the live contract test.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface PropSchema {
  type?: string;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  items?: PropSchema;
  properties?: Record<string, PropSchema>;
}

export type Samples = Record<string, unknown>;

export type ToolArgs = Record<string, unknown>;

function sampleValue(name: string, prop: PropSchema, samples: Samples): unknown {
  if (prop.enum?.length) return prop.enum[0];
  if (Object.hasOwn(samples, name)) return samples[name];
  switch (prop.type) {
    case 'number':
    case 'integer':
      return prop.minimum ?? 1;
    case 'boolean':
      return true;
    case 'array': return [sampleValue(name + '[]', prop.items ?? {}, samples)];
    case 'object':
      return Object.fromEntries(
        Object.entries(prop.properties ?? {}).map(([key, child]) => [key, sampleValue(key, child, samples)]),
      );
    default:
      if (prop.pattern?.includes('\\d{4}-\\d{2}-\\d{2}')) return '2020-01-01';
      return 'sample';
  }
}

function properties(tool: Tool): Record<string, PropSchema> {
  return (tool.inputSchema.properties ?? {});
}

/** Every declared argument populated, enums at their first value. */
export function fullArgs(tool: Tool, samples: Samples = {}): ToolArgs {
  return Object.fromEntries(
    Object.entries(properties(tool)).map(([name, prop]) => [name, sampleValue(name, prop, samples)]),
  );
}

/** Only the required arguments. */
export function minimalArgs(tool: Tool, samples: Samples = {}): ToolArgs {
  const full = fullArgs(tool, samples);
  return Object.fromEntries((tool.inputSchema.required ?? []).map((name) => [name, full[name]]));
}

/** Enumerate nested object and array item enums without dropping sibling arguments. */
function enumAlternatives(prop: PropSchema, base: unknown): Array<{ suffix: string; value: unknown }> {
  const variants = (prop.enum ?? [])
    .filter((value) => JSON.stringify(value) !== JSON.stringify(base))
    .map((value) => ({ suffix: '', value }));
  if (prop.type === 'array' && prop.items) {
    const items = Array.isArray(base) ? base : [];
    for (const child of enumAlternatives(prop.items, items[0])) {
      variants.push({ suffix: '[]' + child.suffix, value: [child.value, ...items.slice(1)] });
    }
  }
  if (prop.type === 'object') {
    const object = (base ?? {}) as Record<string, unknown>;
    for (const [key, child] of Object.entries(prop.properties ?? {})) {
      for (const variant of enumAlternatives(child, object[key])) {
        variants.push({ suffix: '.' + key + variant.suffix, value: { ...object, [key]: variant.value } });
      }
    }
  }
  return variants;
}

/** Full args, one variant for every extra enum value, then required-only args. */
export function argVariants(tool: Tool, samples: Samples = {}): Array<{ label: string; args: ToolArgs }> {
  const full = fullArgs(tool, samples);
  const variants = [{ label: 'all args', args: full }];
  for (const [name, prop] of Object.entries(properties(tool))) {
    for (const variant of enumAlternatives(prop, full[name])) {
      variants.push({ label: name + variant.suffix + '=' + JSON.stringify(variant.value), args: { ...full, [name]: variant.value } });
    }
  }
  variants.push({ label: 'required only', args: minimalArgs(tool, samples) });
  return variants;
}
