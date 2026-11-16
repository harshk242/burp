import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { argVariants as variants, type Samples } from '../../__test-utils__/tool-args.js';

export const samples: Samples = {
  query: 'cancer', additional_query: 'cancer', max_results: 2, start: 1,
  date_start: '2020/01/01', date_end: '2021/12/31', min_date: '2020/01/01', max_date: '2021/12/31',
  'publication_types[]': 'Review', language: 'English', 'journals[]': 'Nature',
  author_name: 'Smith J', journal_name: 'Nature', condition: 'Diabetes Mellitus', intervention: 'Metformin',
  pmid: '28485846', 'pmids[]': '28485846', start_year: 2025, end_year: 2026,
};
export const argVariants = (tool: Tool) => variants(tool, samples);
