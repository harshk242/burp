import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';

export const samples: Samples = {
  query: 'TP53', gene: 'TP53', disease: 'cancer', species: 'Homo sapiens',
  id: 'R-HSA-4419969', pathwayId: 'R-HSA-4419969', size: 3,
};
export const argVariants = (tool: Tool) => variants(tool, samples);
