import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';
import { searchHandlers, proteinHandlers } from '../tools/index.js';
export { tools } from '../tools/index.js';
export const handlers = { ...searchHandlers, ...proteinHandlers };
export const samples: Samples = {
  accession: 'P04637', accessions: ['P04637', 'P00533'], query: 'kinase',
  gene: 'TP53', species: ['human', 'mouse'], organism: 'Homo sapiens', size: 3,
  goTerm: 'GO:0004672', function: 'kinase', localization: 'nucleus',
  taxonomyId: 9606, taxonomyName: 'Mammalia', minLength: 100, maxLength: 2000,
  minMass: 10000, maxMass: 250000, keywords: ['Kinase'],
};
export function argVariants(tool: Tool) {
  // Excluding TP53 itself leaves no other reviewed human ortholog; use mouse.
  const result = variants(tool, tool.name === 'get_protein_orthologs' ? { ...samples, organism: 'Mus musculus' } : samples);
  // These schemas cannot express their at-least-one constraint. Keep the empty
  // required-only case and test its validation, plus both valid minimal choices.
  const alternatives = tool.name === 'search_by_function' ? ['goTerm', 'function']
    : tool.name === 'search_by_taxonomy' ? ['taxonomyId', 'taxonomyName'] : [];
  for (const key of alternatives) result.push({ label: `${key} only`, args: { [key]: samples[key] } });
  return result;
}
export const rejectsEmpty = (name: string, args: Record<string, unknown>) =>
  ['search_by_function', 'search_by_taxonomy'].includes(name) && Object.keys(args).length === 0;
export const clientSide = {
  format: 'Comparison TSV is rendered locally from the same JSON protein entries; output tested in both formats.',
};
