/**
 * Builds tool arguments straight from the published input schemas, so tests
 * exercise every argument a model can send — not only the ones a test author
 * remembered. Shared by the offline unit test and the live contract test.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

interface PropSchema {
  type?: string;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  properties?: Record<string, PropSchema>;
}

export type ToolArgs = Record<string, unknown>;

/** Real values the live API resolves (NCT01141153 has conditions, interventions and phases). */
const SAMPLE_STRINGS: Record<string, string> = {
  nctId: 'NCT01141153',
  minAge: '18 Years',
  maxAge: '65 Years',
  sponsor: 'Merck',
  country: 'United States',
  includeCountry: 'United States',
  excludeCountry: 'France',
  state: 'California',
  city: 'Boston',
  location: 'Boston',
  facilityName: 'Massachusetts General Hospital',
  intervention: 'pembrolizumab',
  outcome: 'overall survival',
  inclusionKeywords: 'prior chemotherapy',
  exclusionKeywords: 'pregnant',
  status: 'RECRUITING',
};

function sampleValue(name: string, prop: PropSchema): unknown {
  if (prop.enum?.length) return prop.enum[0];
  switch (prop.type) {
    case 'number':
    case 'integer':
      return prop.minimum ?? 1;
    case 'boolean':
      return true;
    case 'object':
      return Object.fromEntries(
        Object.entries(prop.properties ?? {}).map(([key, child]) => [key, sampleValue(key, child)]),
      );
    default:
      if (prop.pattern?.includes('\\d{4}-\\d{2}-\\d{2}')) return '2020-01-01';
      return SAMPLE_STRINGS[name] ?? (/phase/i.test(name) ? 'PHASE2' : 'cancer');
  }
}

function properties(tool: Tool): Record<string, PropSchema> {
  return (tool.inputSchema.properties ?? {}) as Record<string, PropSchema>;
}

/** Every declared argument populated, enums at their first value. */
export function fullArgs(tool: Tool): ToolArgs {
  return Object.fromEntries(
    Object.entries(properties(tool)).map(([name, prop]) => [name, sampleValue(name, prop)]),
  );
}

/** Only the required arguments. */
export function minimalArgs(tool: Tool): ToolArgs {
  const full = fullArgs(tool);
  return Object.fromEntries((tool.inputSchema.required ?? []).map((name) => [name, full[name]]));
}

/**
 * Argument sets covering every argument and every enum value: the full set,
 * then one variant per remaining enum value, then the required-only set.
 */
export function argVariants(tool: Tool): Array<{ label: string; args: ToolArgs }> {
  const full = fullArgs(tool);
  const variants = [{ label: 'all args', args: full }];
  for (const [name, prop] of Object.entries(properties(tool))) {
    for (const value of prop.enum?.slice(1) ?? []) {
      variants.push({ label: `${name}=${String(value)}`, args: { ...full, [name]: value } });
    }
  }
  variants.push({ label: 'required only', args: minimalArgs(tool) });
  return variants;
}
