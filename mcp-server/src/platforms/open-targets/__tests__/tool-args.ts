import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';

// Public IDs verified against the live API; an empty cursor starts the first page.
export const samples: Samples = {
  ensembl_id: 'ENSG00000141510', efo_id: 'MONDO_0004989', chembl_id: 'CHEMBL25',
  variant_id: '19_44908684_T_C', study_id: 'GCST90024503',
  study_locus_id: '000b8a706a45ce52de5cbb9bd8db60c7',
  query_string: 'TP53', query_prefix: 'brca', entity_id: 'ENSG00000141510',
  category_id: 'target', cursor: '', page_index: 0, page_size: 2, size: 2,
  start_year: 2020, end_year: 2024, start_month: 1, end_month: 12,
  threshold: 0.5, score_threshold: 0.5, max_suggestions: 2,
  entity_names: ['target'], disease_ids: ['MONDO_0004989'], go_ids: ['GO:0005515'],
  datasource_ids: ['ot_genetics_portal'], query_terms: ['TP53'],
  additional_entity_ids: ['MONDO_0004989'], study_ids: ['GCST90024503'],
  variant_ids: ['19_44908684_T_C'],
  study_locus_ids: ['000b8a706a45ce52de5cbb9bd8db60c7'], regions: ['19:44900000-45000000'],
};
export const argVariants = (tool: Tool) => variants(tool, samples);

const paging = { page_index: 'Upstream returns the full list; page is sliced locally.', page_size: 'Upstream returns the full list; page is sliced locally.' };
export const clientSideArgs: Record<string, Record<string, string>> = {
  get_target_pathways_and_go_terms: paging,
  get_target_mouse_phenotypes: paging,
  get_target_known_drugs: paging,
  get_variant_pharmacogenomics: paging,
  get_target_literature_occurrences: { size: 'Upstream literature uses cursor paging; rows are limited locally.' },
  search_suggestions: { max_suggestions: 'Fuzzy matching limits suggestions locally after fetching candidates.' },
};
