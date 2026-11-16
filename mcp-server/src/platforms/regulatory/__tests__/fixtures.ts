import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import type { DrugsFdaRecord, EmaMedicine, LabelRecord } from '../types.js';

export interface Seen {
  url: string;
  search: string;
  params: Record<string, unknown>;
}

type Route = (config: InternalAxiosRequestConfig, search: string) => { status?: number; data: unknown } | undefined;

/** Routes each request to a fixture; unmatched openFDA searches answer like openFDA does (404 NOT_FOUND). */
export function fakeApis(route: Route): { adapter: AxiosAdapter; seen: Seen[] } {
  const seen: Seen[] = [];
  const adapter: AxiosAdapter = async (config) => {
    const params = (config.params ?? {}) as Record<string, unknown>;
    const search = typeof params.search === 'string' ? params.search : '';
    seen.push({ url: config.url ?? '', search, params });
    const answer = route(config, search) ?? { status: 404, data: { error: { code: 'NOT_FOUND', message: 'No matches found!' } } };
    return { data: answer.data, status: answer.status ?? 200, statusText: 'OK', headers: {}, config };
  };
  return { adapter, seen };
}

export const page = <T>(results: T[], total = results.length) => ({
  data: { meta: { last_updated: '2026-11-13', results: { skip: 0, limit: results.length, total } }, results },
});

export const blenrep: DrugsFdaRecord = {
  application_number: 'BLA761440',
  sponsor_name: 'GLAXOSMITHKLINE LLC',
  openfda: { brand_name: ['BLENREP'], generic_name: ['BELANTAMAB MAFODOTIN'] },
  products: [{ brand_name: 'BLENREP', dosage_form: 'INJECTABLE', route: 'INJECTION', marketing_status: 'Prescription', active_ingredients: [{ name: 'BELANTAMAB MAFODOTIN-BLMF', strength: '70MG' }] }],
  submissions: [
    { submission_type: 'SUPPL', submission_status: 'AP', submission_status_date: '20260301', application_docs: [{ type: 'Label', url: 'https://example.test/new-label.pdf', date: '20260302' }] },
    {
      submission_type: 'ORIG', submission_status: 'AP', submission_status_date: '20251023', review_priority: 'STANDARD',
      submission_class_code_description: 'Type 2 - New Active Ingredient', submission_property_type: [{ code: 'Orphan' }],
      application_docs: [{ type: 'Label', url: 'https://example.test/orig-label.pdf', date: '20251024' }, { type: 'Letter', url: 'https://example.test/letter.pdf', date: '20251027' }],
    },
  ],
};

export const isembyld: DrugsFdaRecord = {
  application_number: 'BLA761463',
  sponsor_name: 'SCHOLAR ROCK',
  products: [{ brand_name: 'ISEMBYLD', marketing_status: 'Prescription', active_ingredients: [{ name: 'APITEGROMAB-MSTN' }] }],
  submissions: [{ submission_type: 'ORIG', submission_status: 'AP', submission_status_date: '20260911', submission_class_code_description: 'Type 1 - New Molecular Entity' }],
};

export const spinraza: DrugsFdaRecord = {
  application_number: 'NDA209531',
  products: [{ brand_name: 'SPINRAZA', marketing_status: 'Prescription' }],
  submissions: [{ submission_type: 'ORIG', submission_status: 'AP', submission_status_date: '20161223' }],
};

export const tentative: DrugsFdaRecord = {
  application_number: 'NDA220446',
  products: [{ brand_name: 'APIXABAN', marketing_status: 'None (Tentative Approval)' }],
  submissions: [{ submission_type: 'ORIG', submission_status: 'TA', submission_status_date: '20261001' }],
};

export const label = (app: string, brand: string, indication: string, extra: Partial<LabelRecord> = {}): LabelRecord => ({
  set_id: `set-${app}`,
  version: '3',
  effective_time: '20260616',
  openfda: { application_number: [app], brand_name: [brand], generic_name: [brand.toLowerCase()], manufacturer_name: ['Maker'] },
  indications_and_usage: [`1 INDICATIONS AND USAGE ${brand} is indicated for the treatment of ${indication}.`],
  ...extra,
});

export const ema = (overrides: Partial<EmaMedicine>): EmaMedicine => ({
  category: 'Human',
  name_of_medicine: 'Example',
  active_substance: 'examplumab',
  international_non_proprietary_name_common_name: 'examplumab',
  medicine_status: 'Authorised',
  therapeutic_area_mesh: 'Neoplasms',
  therapeutic_indication: 'Example is indicated for cancer.',
  marketing_authorisation_date: '01/02/2020',
  orphan_medicine: 'No',
  conditional_approval: 'No',
  medicine_url: 'https://www.ema.europa.eu/en/medicines/human/EPAR/example',
  ...overrides,
});
