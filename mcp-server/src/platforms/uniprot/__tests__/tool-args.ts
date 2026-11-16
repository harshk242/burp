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
  // Homologs match the exact protein name and orthologs the primary gene. Excluding
  // TP53 itself leaves no other reviewed human match for either; use mouse.
  const mouse = ['get_protein_homologs', 'get_protein_orthologs'].includes(tool.name);
  const result = variants(tool, mouse ? { ...samples, organism: 'Mus musculus' } : samples);
  // These schemas cannot express their at-least-one constraint. Keep the empty
  // required-only case and test its validation, plus both valid minimal choices.
  const alternatives = tool.name === 'search_by_function' ? ['goTerm', 'function']
    : tool.name === 'search_by_taxonomy' ? ['taxonomyId', 'taxonomyName'] : [];
  for (const key of alternatives) result.push({ label: `${key} only`, args: { [key]: samples[key] } });
  return result;
}
export const rejectsEmpty = (name: string, args: Record<string, unknown>) =>
  ['search_by_function', 'search_by_taxonomy'].includes(name) && Object.keys(args).length === 0;
export const clientSide: Record<string, Record<string, string>> = {
  compare_proteins: {
    format: 'Comparison TSV is rendered locally from the same JSON protein entries; output tested in both formats.',
  },
  // UniProt ignores fields= for XML, so these request projected JSON and build XML
  // locally (search.test.ts and entries.test.ts parse the XML output).
  search_proteins: { 'format="xml"': 'Summary XML is built locally from the field-projected JSON search.' },
  get_protein_info: { 'format="xml"': 'Slim XML is built locally from the field-projected JSON entry.' },
};
// batch_protein_lookup de-duplicates accessions before one /uniprotkb/accessions
// request, so the generic duplicated-array alternative would not change it.
export const alternatives: Record<string, Record<string, unknown>> = {
  batch_protein_lookup: { accessions: ['P38398', 'P04637-2'] },
};
