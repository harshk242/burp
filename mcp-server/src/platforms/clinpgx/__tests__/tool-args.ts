import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';
export const samples: Samples = { gene: 'CYP2D6', drug: 'codeine', variantId: 'rs3892097', query: 'CYP2D6', maxResults: 2 };
export function toolSamples(tool: Tool): Samples {
  return { ...samples, query: tool.name === 'search_drugs' ? 'codeine' : tool.name === 'search_variants' ? 'rs3892097' : 'CYP2D6' };
}
export function argVariants(tool: Tool) {
  const result = variants(tool, toolSamples(tool));
  if (['get_dosing_guidelines', 'get_clinical_annotations'].includes(tool.name)) {
    result.push({ label: 'gene only', args: { gene: samples.gene } }, { label: 'drug only', args: { drug: samples.drug } });
    if (tool.name === 'get_dosing_guidelines') for (const source of ['CPIC', 'DPWG']) result.push({ label: `drug with ${source}`, args: { drug: samples.drug, source } });
  }
  return result;
}
export const missingCriteria = (name: string, args: Record<string, unknown>) =>
  ['get_dosing_guidelines', 'get_clinical_annotations'].includes(name) && !args.gene && !args.drug;
