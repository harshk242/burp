import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const samples: Samples = {
  gene: 'TP53', condition: 'Li-Fraumeni syndrome', clinical_significance: 'pathogenic',
  max_results: 1, variation_id: '17661', 'variation_ids[]': '17661',
  chromosome: '17', start: 7676154, stop: 7676155, rs_id: 'rs1042522',
};
export const argVariants = (tool: Tool) => variants(tool, samples);
