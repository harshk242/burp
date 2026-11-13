import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';

export const samples: Samples = {
  query: 'aspirin', limit: 2, offset: 1, chembl_id: 'CHEMBL25',
  target_chembl_id: 'CHEMBL203', molecule_chembl_id: 'CHEMBL25', assay_chembl_id: 'CHEMBL655942',
  molecule_chembl_ids: ['CHEMBL25', 'CHEMBL59'], chembl_ids: ['CHEMBL25', 'CHEMBL59'],
  activity_type: 'IC50', units: 'nM', min_value: 1, max_value: 1000,
  uniprot_id: 'P00533', inchi: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N',
  smiles: 'CC(=O)Oc1ccccc1C(=O)O', similarity: 0.7,
  target_type: 'SINGLE PROTEIN', organism: 'Homo sapiens', indication: 'asthma',
  min_mw: 100, max_mw: 400, min_logp: 0, max_logp: 3, max_hbd: 3, max_hba: 6,
};
export function samplesFor(tool: Tool): Samples {
  return { ...samples, ...(tool.name === 'search_targets' ? { query: 'kinase' } : {}),
    ...(tool.name === 'get_target_info' ? { chembl_id: 'CHEMBL203' } : {}),
    ...(tool.name === 'get_assay_info' ? { chembl_id: 'CHEMBL655942' } : {}) };
}
export const argVariants = (tool: Tool) => variants(tool, samplesFor(tool));
