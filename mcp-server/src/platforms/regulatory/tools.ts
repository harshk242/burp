import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { EMA_STATUSES } from './ema.js';
import { DEFAULT_LABEL_SECTIONS, LABEL_SECTIONS } from './fda-label.js';

const ISO_DATE = '^\\d{4}-\\d{2}-\\d{2}$';

export const tools: Tool[] = [
  {
    name: 'search_fda_approvals',
    description:
      'US FDA approval status from openFDA (Drugs@FDA plus drug labels). Returns each application (NDA/BLA) with ' +
      'original approval date, approval class (e.g. New Molecular Entity), orphan flag, marketing status ' +
      '(prescription/discontinued) and links to the approval letter and label. Search by drug (brand or generic ' +
      'name), by indication (finds every FDA-labelled drug for a disease, including approvals newer than your ' +
      'training data), by application number, or list original approvals in a date window. ' +
      'Use this, not ChEMBL max_phase or Open Targets stage, for any claim that a drug is FDA approved.',
    inputSchema: {
      type: 'object',
      properties: {
        drug: { type: 'string', description: 'Brand or generic name, e.g. "Blenrep" or "belantamab mafodotin". Give only one of drug, indication, application_number.' },
        indication: { type: 'string', description: 'Disease or indication phrase searched in label "Indications and Usage", e.g. "spinal muscular atrophy".' },
        application_number: { type: 'string', description: 'FDA application number, e.g. BLA761440 or NDA021588.' },
        approved_from: { type: 'string', pattern: ISO_DATE, description: 'Only applications whose original approval is on or after this date (YYYY-MM-DD). Alone, lists new approvals in the window.' },
        approved_to: { type: 'string', pattern: ISO_DATE, description: 'Only applications whose original approval is on or before this date (YYYY-MM-DD).' },
        include_generics: { type: 'boolean', description: 'Include ANDA generic applications (default false).' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum applications to return (default 25).' },
      },
    },
  },
  {
    name: 'get_fda_label',
    description:
      'Read the current FDA prescribing information (label) for a drug from openFDA/DailyMed: indications, boxed ' +
      'warning, contraindications, warnings, dosing, interactions and other sections, with label date and set ID. ' +
      'Use it to quote what the label actually says (e.g. boxed-warning content or the approved indication wording).',
    inputSchema: {
      type: 'object',
      properties: {
        drug: { type: 'string', description: 'Brand or generic name. Give only one of drug, application_number, set_id.' },
        application_number: { type: 'string', description: 'FDA application number, e.g. NDA203214.' },
        set_id: { type: 'string', description: 'DailyMed SPL set ID.' },
        sections: {
          type: 'array',
          items: { type: 'string', enum: [...LABEL_SECTIONS] },
          description: `Label sections to return (default: ${DEFAULT_LABEL_SECTIONS.join(', ')}). Older labels use "warnings"/"precautions" instead of "warnings_and_cautions".`,
        },
        max_chars_per_section: { type: 'integer', minimum: 200, maximum: 20000, description: 'Truncate each section to this many characters (default 4000).' },
      },
    },
  },
  {
    name: 'search_ema_medicines',
    description:
      'EU regulatory status from the European Medicines Agency: centrally authorised human medicines with status ' +
      '(authorised, withdrawn, refused, expired, suspended), marketing authorisation date, conditional/orphan/' +
      'biosimilar flags, holder, therapeutic area and indication. Search by medicine or substance name, by ' +
      'therapeutic area/indication, or by authorisation date window. Nationally authorised medicines are not covered.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Medicine (brand), active substance or INN, matched as a case-insensitive substring, e.g. "Hepcludex" or "bulevirtide".' },
        therapeutic_area: { type: 'string', description: 'Substring of the therapeutic area (MeSH) or indication text, e.g. "spinal muscular atrophy".' },
        status: { type: 'string', enum: [...EMA_STATUSES], description: 'Filter by EMA status (default any).' },
        authorised_from: { type: 'string', pattern: ISO_DATE, description: 'Only medicines with a marketing authorisation on or after this date (YYYY-MM-DD).' },
        authorised_to: { type: 'string', pattern: ISO_DATE, description: 'Only medicines with a marketing authorisation on or before this date (YYYY-MM-DD).' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum medicines to return (default 20).' },
      },
    },
  },
];
