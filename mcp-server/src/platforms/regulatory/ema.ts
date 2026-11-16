import { EMA_MEDICINES_PATH, getClients, onClientReset } from './client.js';
import type { EmaDataset, EmaMedicine } from './types.js';

export const EMA_STATUSES = [
  'any',
  'Authorised',
  'Opinion',
  'Withdrawn',
  'Expired',
  'Lapsed',
  'Revoked',
  'Suspended',
  'Refused',
  'Application withdrawn',
] as const;

export type EmaStatus = (typeof EMA_STATUSES)[number];

export interface EmaSearchArgs {
  query?: string | undefined;
  therapeuticArea?: string | undefined;
  status: EmaStatus;
  authorisedFrom?: string | undefined;
  authorisedTo?: string | undefined;
  limit: number;
}

export const EMA_COVERAGE_NOTE =
  'EU centrally authorised human medicines from the EMA medicines data file (EPARs), including withdrawn, ' +
  'refused and expired ones. Medicines authorised only nationally by EU member states (many older drugs) are ' +
  'not listed, so absence is not proof that a drug has no EU authorisation.';

// The file is regenerated daily; one download serves every call in that window.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const INDICATION_CHARS = 600;

let cached: { loadedAt: number; dataset: Promise<EmaDataset> } | null = null;
onClientReset(() => { cached = null; });

function isDataset(value: unknown): value is EmaDataset {
  return typeof value === 'object' && value !== null && Array.isArray((value as EmaDataset).data);
}

async function download(): Promise<EmaDataset> {
  const response = await getClients().ema.get<unknown>(EMA_MEDICINES_PATH, { responseType: 'json' });
  const data: unknown = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  if (!isDataset(data)) throw new Error('EMA medicines file has an unexpected shape (no data array)');
  return data;
}

export function loadEmaDataset(now = Date.now()): Promise<EmaDataset> {
  if (!cached || now - cached.loadedAt > CACHE_TTL_MS) {
    const dataset = download();
    cached = { loadedAt: now, dataset };
    // A failed download must not be served from the cache.
    dataset.catch(() => { if (cached?.dataset === dataset) cached = null; });
  }
  return cached.dataset;
}

/** EMA dates are `dd/mm/yyyy`. */
export function emaDate(value: string | undefined): string | null {
  const match = value ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim()) : null;
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

const norm = (value: string | undefined) => (value ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const yes = (value: string | undefined) => value?.trim().toLowerCase() === 'yes';

function matchesQuery(medicine: EmaMedicine, query: string): boolean {
  const needle = norm(query);
  return [medicine.name_of_medicine, medicine.active_substance, medicine.international_non_proprietary_name_common_name]
    .some((field) => norm(field).includes(needle));
}

function matchesArea(medicine: EmaMedicine, area: string): boolean {
  const needle = norm(area);
  return norm(medicine.therapeutic_area_mesh).includes(needle) || norm(medicine.therapeutic_indication).includes(needle);
}

function summarize(m: EmaMedicine) {
  const flags = Object.entries({
    conditional_approval: m.conditional_approval,
    exceptional_circumstances: m.exceptional_circumstances,
    orphan_medicine: m.orphan_medicine,
    generic: m.generic,
    biosimilar: m.biosimilar,
    advanced_therapy: m.advanced_therapy,
    prime_priority_medicine: m.prime_priority_medicine,
    accelerated_assessment: m.accelerated_assessment,
  }).filter(([, value]) => yes(value)).map(([key]) => key);
  const indication = (m.therapeutic_indication ?? '').replace(/\s+/g, ' ').trim();
  return {
    name: m.name_of_medicine ?? null,
    active_substance: m.active_substance ?? null,
    inn: m.international_non_proprietary_name_common_name ?? null,
    status: m.medicine_status ?? null,
    marketing_authorisation_date: emaDate(m.marketing_authorisation_date),
    latest_ec_decision_date: emaDate(m.european_commission_decision_date),
    chmp_opinion_date: emaDate(m.opinion_adopted_date),
    withdrawal_expiry_revocation_lapse_date: emaDate(m.withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date),
    suspension_date: emaDate(m.suspension_of_marketing_authorisation_date),
    refusal_date: emaDate(m.refusal_of_marketing_authorisation_date),
    application_withdrawal_date: emaDate(m.withdrawal_of_application_date),
    flags,
    marketing_authorisation_holder: m.marketing_authorisation_developer_applicant_holder ?? null,
    therapeutic_area: m.therapeutic_area_mesh || null,
    atc_code: m.atc_code_human || null,
    indication: indication.length > INDICATION_CHARS ? indication.slice(0, INDICATION_CHARS) + '…' : indication || null,
    ema_product_number: m.ema_product_number ?? null,
    url: m.medicine_url ?? null,
  };
}

export async function searchEmaMedicines(args: EmaSearchArgs) {
  const dataset = await loadEmaDataset();
  const [from, to] = [args.authorisedFrom ?? '0000-00-00', args.authorisedTo ?? '9999-99-99'];
  const dated = Boolean(args.authorisedFrom || args.authorisedTo);
  const matches = (dataset.data ?? [])
    .filter((m) => (m.category ?? 'Human') === 'Human')
    .filter((m) => !args.query || matchesQuery(m, args.query))
    .filter((m) => !args.therapeuticArea || matchesArea(m, args.therapeuticArea))
    .filter((m) => args.status === 'any' || m.medicine_status === args.status)
    .map(summarize)
    .filter((m) => !dated || (m.marketing_authorisation_date !== null && m.marketing_authorisation_date >= from && m.marketing_authorisation_date <= to))
    .sort((a, b) => (b.marketing_authorisation_date ?? b.chmp_opinion_date ?? '').localeCompare(a.marketing_authorisation_date ?? a.chmp_opinion_date ?? ''));
  return {
    source: 'EMA medicines data (European public assessment reports)',
    data_timestamp: dataset.meta?.timestamp ?? null,
    total_matches: matches.length,
    returned: Math.min(matches.length, args.limit),
    medicines: matches.slice(0, args.limit),
    coverage_note: EMA_COVERAGE_NOTE,
  };
}
