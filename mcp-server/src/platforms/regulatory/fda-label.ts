import { anyOf, applicationNumbers, dailyMedUrl, isoDate, labelNameQuery, openFdaGet, phrase, sectionText } from './openfda-query.js';
import type { LabelRecord } from './types.js';

export const LABEL_SECTIONS = [
  'indications_and_usage',
  'boxed_warning',
  'contraindications',
  'warnings_and_cautions',
  'warnings',
  'precautions',
  'dosage_and_administration',
  'adverse_reactions',
  'drug_interactions',
  'use_in_specific_populations',
  'mechanism_of_action',
  'clinical_studies',
  'recent_major_changes',
] as const;

export type LabelSection = (typeof LABEL_SECTIONS)[number];

export const DEFAULT_LABEL_SECTIONS: LabelSection[] = ['indications_and_usage', 'boxed_warning', 'contraindications', 'recent_major_changes'];

export interface LabelArgs {
  drug?: string | undefined;
  applicationNumber?: string | undefined;
  setId?: string | undefined;
  sections: LabelSection[];
  maxCharsPerSection: number;
}

const CANDIDATES = 5;
const EXCLUDE_ANDA_LABEL = 'NOT openfda.application_number:ANDA*';

function identity(label: LabelRecord) {
  return {
    set_id: label.set_id ?? null,
    brand_names: label.openfda?.brand_name ?? [],
    generic_names: label.openfda?.generic_name ?? [],
    manufacturer: label.openfda?.manufacturer_name?.[0] ?? null,
    application_numbers: label.openfda?.application_number ?? [],
    effective_date: isoDate(label.effective_time),
  };
}

async function findLabels(args: LabelArgs) {
  const sort = 'effective_time:desc';
  if (args.setId) return openFdaGet<LabelRecord>('label', `set_id:${phrase(args.setId)}`, { limit: CANDIDATES, sort });
  if (args.applicationNumber) {
    return openFdaGet<LabelRecord>('label', anyOf('openfda.application_number', applicationNumbers(args.applicationNumber)), { limit: CANDIDATES, sort });
  }
  // Prefer the innovator (NDA/BLA) label; fall back to any label, e.g. for drugs sold only as generics.
  const byName = labelNameQuery(args.drug ?? '');
  const branded = await openFdaGet<LabelRecord>('label', `${byName} AND ${EXCLUDE_ANDA_LABEL}`, { limit: CANDIDATES, sort });
  return branded.results.length > 0 ? branded : openFdaGet<LabelRecord>('label', byName, { limit: CANDIDATES, sort });
}

export async function getFdaLabel(args: LabelArgs) {
  const page = await findLabels(args);
  const label = page.results[0];
  if (!label) {
    return {
      source: 'openFDA drug labels (DailyMed SPL)',
      found: false,
      message: 'No FDA label matched. This does not prove the product is unapproved: CBER biologics, discontinued drugs and very new approvals can be missing.',
    };
  }
  const sections: Record<string, { text: string; truncated: boolean; full_length: number } | null> = {};
  for (const name of args.sections) {
    const text = sectionText(label, name);
    sections[name] = text === null ? null : {
      text: text.length > args.maxCharsPerSection ? text.slice(0, args.maxCharsPerSection) + '…' : text,
      truncated: text.length > args.maxCharsPerSection,
      full_length: text.length,
    };
  }
  return {
    source: 'openFDA drug labels (DailyMed SPL)',
    data_last_updated: page.lastUpdated,
    found: true,
    label: {
      ...identity(label),
      version: label.version ?? null,
      dailymed_url: dailyMedUrl(label.set_id),
    },
    sections,
    absent_sections: args.sections.filter((name) => sections[name] === null),
    other_matching_labels: {
      total: Math.max(0, page.total - 1),
      examples: page.results.slice(1).map(identity),
    },
  };
}
