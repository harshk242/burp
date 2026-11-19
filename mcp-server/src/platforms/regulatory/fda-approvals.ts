import {
  anyOf, applicationNumbers, dailyMedUrl, drugNameQuery, excerpt, isoDate, labelNameQuery, openFdaGet, phrase, sectionText,
} from './openfda-query.js';
import { decodeDrugsFdaRecord, decodeLabelRecord } from './decode.js';
import type { DrugsFdaRecord, FdaApplication, FdaLabelSummary, FdaSubmission, LabelRecord } from './types.js';

export interface ApprovalSearchArgs {
  drug?: string | undefined;
  indication?: string | undefined;
  applicationNumber?: string | undefined;
  approvedFrom?: string | undefined;
  approvedTo?: string | undefined;
  includeGenerics: boolean;
  limit: number;
}

const NAME_PAGE = 100;
const LABEL_PAGE = 100;
const DATE_SCAN_PAGE = 1000;
const BATCH = 50;
const EXCLUDE_ANDA = 'NOT application_number:ANDA*';
const EXCLUDE_ANDA_LABEL = 'NOT openfda.application_number:ANDA*';

export const FDA_COVERAGE_NOTE =
  'US FDA only (openFDA). Drugs@FDA covers CDER drugs and therapeutic biologics. CBER products (gene and cell ' +
  'therapies, vaccines, blood products) are found only through their labels and have no approval date here. ' +
  'No record is not proof that a drug is unapproved in the US; for other regions use the EMA tool or literature.';

const LABEL_ONLY_NOTE =
  'No Drugs@FDA record; listed from its FDA label, which carries this application number. CBER-regulated ' +
  'products are not in Drugs@FDA, so the approval date is not available here.';

const byDateDesc = (a: string | undefined, b: string | undefined) => (b ?? '').localeCompare(a ?? '');
const unique = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))];

function newestDoc(submissions: FdaSubmission[], type: string): string | null {
  const docs = submissions.flatMap((s) => s.application_docs ?? []).filter((d) => d.type === type && d.url);
  return docs.sort((a, b) => byDateDesc(a.date, b.date))[0]?.url ?? null;
}

export function normalizeApplication(record: DrugsFdaRecord): FdaApplication {
  const number = record.application_number ?? 'unknown';
  const submissions = record.submissions ?? [];
  const approved = submissions
    .filter((s) => s.submission_status === 'AP' && s.submission_status_date)
    .sort((a, b) => byDateDesc(a.submission_status_date, b.submission_status_date));
  const original = submissions.find((s) => s.submission_type === 'ORIG' && s.submission_status === 'AP');
  const latest = approved[0];
  const products = record.products ?? [];
  const application: FdaApplication = {
    application_number: number,
    application_type: /^[A-Z]+/.exec(number)?.[0] ?? 'unknown',
    brand_names: unique([...(record.openfda?.brand_name ?? []), ...products.map((p) => p.brand_name)].map((n) => n?.toUpperCase())),
    generic_names: unique(record.openfda?.generic_name?.length
      ? record.openfda.generic_name
      : products.flatMap((p) => (p.active_ingredients ?? []).map((i) => i.name))),
    sponsor: record.sponsor_name ?? null,
    in_drugs_at_fda: true,
    original_approval: original ? {
      date: isoDate(original.submission_status_date) ?? 'unknown',
      submission_class: original.submission_class_code_description ?? null,
      review_priority: original.review_priority ?? null,
      orphan: (original.submission_property_type ?? []).some((p) => p.code === 'Orphan'),
    } : null,
    latest_approved_submission: latest ? {
      type: latest.submission_type ?? 'unknown',
      date: isoDate(latest.submission_status_date) ?? 'unknown',
      class: latest.submission_class_code_description ?? null,
    } : null,
    marketing_status: unique(products.map((p) => p.marketing_status)),
    products: products.slice(0, 6).map((p) => ({
      brand_name: p.brand_name ?? null,
      dosage_form: p.dosage_form ?? null,
      route: p.route ?? null,
      marketing_status: p.marketing_status ?? null,
      active_ingredients: (p.active_ingredients ?? []).map((i) => [i.name, i.strength].filter(Boolean).join(' ')).join('; '),
    })),
    approval_letter_url: original?.application_docs?.find((d) => d.type === 'Letter')?.url ?? null,
    latest_label_pdf_url: newestDoc(submissions, 'Label'),
    drugs_at_fda_url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${number.replace(/\D/g, '')}`,
  };
  if (!original) {
    application.note = submissions.some((s) => s.submission_status === 'TA')
      ? 'Tentative approval only: not yet approved for marketing in the US.'
      : 'No approved original submission in Drugs@FDA.';
  }
  return application;
}

function labelSummary(label: LabelRecord, term?: string): FdaLabelSummary {
  const indications = sectionText(label, 'indications_and_usage');
  return {
    set_id: label.set_id ?? null,
    effective_date: isoDate(label.effective_time),
    indication_excerpt: indications ? excerpt(indications, term) : null,
    dailymed_url: dailyMedUrl(label.set_id),
  };
}

function labelOnlyApplication(number: string, label: LabelRecord, term?: string): FdaApplication {
  return {
    application_number: number,
    application_type: /^[A-Z]+/.exec(number)?.[0] ?? 'unknown',
    brand_names: unique((label.openfda?.brand_name ?? []).map((n) => n.toUpperCase())),
    generic_names: unique(label.openfda?.generic_name ?? []),
    sponsor: label.openfda?.manufacturer_name?.[0] ?? null,
    in_drugs_at_fda: false,
    original_approval: null,
    latest_approved_submission: null,
    marketing_status: [],
    products: [],
    approval_letter_url: null,
    latest_label_pdf_url: null,
    drugs_at_fda_url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${number.replace(/\D/g, '')}`,
    label: labelSummary(label, term),
    note: LABEL_ONLY_NOTE,
  };
}

/** Latest label per application number, in the order the labels were returned. */
function labelsByApplication(labels: LabelRecord[]): { byApp: Map<string, LabelRecord>; withoutApplication: number } {
  const byApp = new Map<string, LabelRecord>();
  let withoutApplication = 0;
  for (const label of labels) {
    const numbers = label.openfda?.application_number ?? [];
    if (numbers.length === 0) withoutApplication++;
    for (const number of numbers) if (!byApp.has(number)) byApp.set(number, label);
  }
  return { byApp, withoutApplication };
}

async function fetchApplications(numbers: string[]): Promise<Map<string, DrugsFdaRecord>> {
  const found = new Map<string, DrugsFdaRecord>();
  for (let i = 0; i < numbers.length; i += BATCH) {
    const chunk = numbers.slice(i, i + BATCH);
    const page = await openFdaGet('drugsfda', anyOf('application_number', chunk), { limit: chunk.length }, decodeDrugsFdaRecord);
    for (const record of page.results) if (record.application_number) found.set(record.application_number, record);
  }
  return found;
}

interface Collected {
  applications: FdaApplication[];
  lastUpdated: string | null;
  notes: string[];
}

async function fromLabels(search: string, term: string | undefined, notes: string[]): Promise<Collected> {
  const labels = await openFdaGet('label', search, { limit: LABEL_PAGE, sort: 'effective_time:desc' }, decodeLabelRecord);
  if (labels.total > labels.results.length) {
    notes.push(`${labels.total} labels matched; only the ${labels.results.length} most recently updated were scanned. Narrow the query to see the rest.`);
  }
  const { byApp, withoutApplication } = labelsByApplication(labels.results);
  if (withoutApplication > 0) notes.push(`${withoutApplication} matching labels carry no FDA application number (unapproved or OTC monograph products) and were skipped.`);
  const records = await fetchApplications([...byApp.keys()]);
  const applications = [...byApp.entries()].map(([number, label]) => {
    const record = records.get(number);
    return record ? { ...normalizeApplication(record), label: labelSummary(label, term) } : labelOnlyApplication(number, label, term);
  });
  return { applications, lastUpdated: labels.lastUpdated, notes };
}

async function fromDrugsFda(search: string, limit: number, notes: string[]): Promise<Collected> {
  const page = await openFdaGet('drugsfda', search, { limit }, decodeDrugsFdaRecord);
  if (page.total > page.results.length) notes.push(`${page.total} applications matched; only ${page.results.length} were scanned. Narrow the query.`);
  return { applications: page.results.map(normalizeApplication), lastUpdated: page.lastUpdated, notes };
}

function dateBounds(from: string | undefined, to: string | undefined): [string, string] {
  return [from ?? '1900-01-01', to ?? '2999-12-31'];
}

export async function searchFdaApprovals(args: ApprovalSearchArgs) {
  const generics = args.includeGenerics;
  const notes: string[] = [];
  let collected: Collected;
  let searchedBy: string;
  if (args.applicationNumber) {
    searchedBy = 'application_number';
    const numbers = applicationNumbers(args.applicationNumber);
    collected = await fromDrugsFda(anyOf('application_number', numbers), numbers.length, notes);
    if (collected.applications.length === 0) collected = await fromLabels(anyOf('openfda.application_number', numbers), undefined, notes);
  } else if (args.drug) {
    searchedBy = 'drug';
    const query = drugNameQuery(args.drug) + (generics ? '' : ` AND ${EXCLUDE_ANDA}`);
    collected = await fromDrugsFda(query, NAME_PAGE, notes);
    if (collected.applications.length === 0) {
      collected = await fromLabels(labelNameQuery(args.drug) + (generics ? '' : ` AND ${EXCLUDE_ANDA_LABEL}`), undefined, notes);
    }
  } else if (args.indication) {
    searchedBy = 'indication';
    const search = `indications_and_usage:${phrase(args.indication)} AND _exists_:openfda.application_number` +
      (generics ? '' : ` AND ${EXCLUDE_ANDA_LABEL}`);
    collected = await fromLabels(search, args.indication, notes);
  } else {
    searchedBy = 'approval_date';
    const [from, to] = dateBounds(args.approvedFrom, args.approvedTo).map((d) => d.replace(/-/g, ''));
    const search = `submissions.submission_type:ORIG AND submissions.submission_status_date:[${from} TO ${to}]` +
      (generics ? '' : ` AND ${EXCLUDE_ANDA}`);
    collected = await fromDrugsFda(search, DATE_SCAN_PAGE, notes);
  }

  let applications = collected.applications;
  if (args.approvedFrom || args.approvedTo) {
    const [from, to] = dateBounds(args.approvedFrom, args.approvedTo);
    const undated = applications.filter((a) => !a.original_approval);
    applications = applications.filter((a) => a.original_approval && a.original_approval.date >= from && a.original_approval.date <= to);
    if (undated.length > 0) {
      notes.push(`Excluded by the date filter because no original approval date is available: ${undated.map((a) => `${a.brand_names[0] ?? a.application_number} (${a.application_number})`).join(', ')}.`);
    }
  }
  applications.sort((a, b) => byDateDesc(a.original_approval?.date, b.original_approval?.date));

  return {
    source: 'openFDA (Drugs@FDA and SPL drug labels)',
    data_last_updated: collected.lastUpdated,
    searched_by: searchedBy,
    total_applications: applications.length,
    returned: Math.min(applications.length, args.limit),
    applications: applications.slice(0, args.limit),
    ...(notes.length > 0 ? { notes } : {}),
    coverage_note: FDA_COVERAGE_NOTE,
  };
}
