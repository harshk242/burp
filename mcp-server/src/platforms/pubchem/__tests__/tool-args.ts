import { readFileSync } from 'node:fs';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';
export const samples: Samples = {
  query: 'aspirin', cid: 2244, cids: [2244, 3672], aid: 1,
  smiles: 'CC(=O)Oc1ccccc1C(=O)O', threshold: 95, max_records: 2,
};
const queries: Record<string, string> = {
  name: 'aspirin', smiles: String(samples.smiles), cid: '2244', formula: 'C9H8O4',
  inchi: 'InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)',
  sdf: readFileSync(new URL('./aspirin.sdf', import.meta.url), 'utf8'),
};
export const argVariants = (tool: Tool) => variants(tool, samples).map(variant => ({
  ...variant, args: tool.name === 'search_compounds'
    ? { ...variant.args, query: queries[String(variant.args.search_type ?? 'name')] } : variant.args,
}));
