import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';
const SAMPLES: Samples = {
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

export function argVariants(tool: Tool) {
  const samples = { ...SAMPLES };
  for (const [name, prop] of Object.entries(tool.inputSchema.properties ?? {})) {
    const p = prop as { type?: string; pattern?: string };
    if (p.type === 'string' && !(name in samples)) {
      samples[name] = p.pattern?.includes('\\d{4}-\\d{2}-\\d{2}') ? '2020-01-01' : /phase/i.test(name) ? 'PHASE2' : 'cancer';
    }
  }
  return variants(tool, samples);
}
