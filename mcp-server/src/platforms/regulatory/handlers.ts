import type { ToolHandler } from '../../types.js';
import { EMA_STATUSES, searchEmaMedicines, type EmaStatus } from './ema.js';
import { searchFdaApprovals } from './fda-approvals.js';
import { DEFAULT_LABEL_SECTIONS, LABEL_SECTIONS, getFdaLabel, type LabelSection } from './fda-label.js';

type Args = Record<string, unknown>;

function text(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  return value.trim() || undefined;
}

function date(args: Args, key: string): string | undefined {
  const value = text(args, key);
  if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) {
    throw new Error(`${key} must be a date in YYYY-MM-DD format`);
  }
  return value;
}

function integer(args: Args, key: string, fallback: number, min: number, max: number): number {
  const value = args[key];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

function oneOf(args: Args, keys: string[], required: boolean): void {
  const given = keys.filter((key) => text(args, key) !== undefined);
  if (given.length > 1) throw new Error(`Give only one of ${keys.join(', ')} (got ${given.join(', ')})`);
  if (required && given.length === 0) throw new Error(`One of ${keys.join(', ')} is required`);
}

function sections(args: Args): LabelSection[] {
  const value = args.sections;
  if (value === undefined) return DEFAULT_LABEL_SECTIONS;
  if (!Array.isArray(value) || value.length === 0) throw new Error('sections must be a non-empty array');
  const allowed = new Set<string>(LABEL_SECTIONS);
  for (const name of value) {
    if (typeof name !== 'string' || !allowed.has(name)) throw new Error(`Unknown label section: ${String(name)}. Allowed: ${LABEL_SECTIONS.join(', ')}`);
  }
  return [...new Set(value as LabelSection[])];
}

export const handlers: Record<string, ToolHandler> = {
  search_fda_approvals: async (args) => {
    oneOf(args, ['drug', 'indication', 'application_number'], false);
    const approvedFrom = date(args, 'approved_from');
    const approvedTo = date(args, 'approved_to');
    const drug = text(args, 'drug');
    const indication = text(args, 'indication');
    const applicationNumber = text(args, 'application_number');
    if (!drug && !indication && !applicationNumber && !approvedFrom && !approvedTo) {
      throw new Error('Give one of drug, indication or application_number, or an approved_from/approved_to window');
    }
    if (args.include_generics !== undefined && typeof args.include_generics !== 'boolean') throw new Error('include_generics must be a boolean');
    return searchFdaApprovals({
      drug, indication, applicationNumber, approvedFrom, approvedTo,
      includeGenerics: args.include_generics === true,
      limit: integer(args, 'limit', 25, 1, 100),
    });
  },

  get_fda_label: async (args) => {
    oneOf(args, ['drug', 'application_number', 'set_id'], true);
    return getFdaLabel({
      drug: text(args, 'drug'),
      applicationNumber: text(args, 'application_number'),
      setId: text(args, 'set_id'),
      sections: sections(args),
      maxCharsPerSection: integer(args, 'max_chars_per_section', 4000, 200, 20000),
    });
  },

  search_ema_medicines: async (args) => {
    const status = (text(args, 'status') ?? 'any') as EmaStatus;
    if (!EMA_STATUSES.includes(status)) throw new Error(`status must be one of: ${EMA_STATUSES.join(', ')}`);
    const query = text(args, 'query');
    const therapeuticArea = text(args, 'therapeutic_area');
    const authorisedFrom = date(args, 'authorised_from');
    const authorisedTo = date(args, 'authorised_to');
    if (!query && !therapeuticArea && !authorisedFrom && !authorisedTo) {
      throw new Error('Give a query, a therapeutic_area, or an authorised_from/authorised_to window');
    }
    return searchEmaMedicines({
      query, therapeuticArea, status, authorisedFrom, authorisedTo,
      limit: integer(args, 'limit', 20, 1, 100),
    });
  },
};
