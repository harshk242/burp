// Fields of openFDA and EMA records the handlers read; everything else is ignored.

export interface OpenFdaSection {
  application_number?: string[] | undefined;
  brand_name?: string[] | undefined;
  generic_name?: string[] | undefined;
  manufacturer_name?: string[] | undefined;
  product_type?: string[] | undefined;
  route?: string[] | undefined;
  substance_name?: string[] | undefined;
}

export interface FdaApplicationDoc {
  url?: string | undefined;
  date?: string | undefined;
  type?: string | undefined;
}

export interface FdaSubmission {
  submission_type?: string | undefined;
  submission_number?: string | undefined;
  submission_status?: string | undefined;
  submission_status_date?: string | undefined;
  review_priority?: string | undefined;
  submission_class_code?: string | undefined;
  submission_class_code_description?: string | undefined;
  submission_property_type?: { code?: string | undefined }[] | undefined;
  application_docs?: FdaApplicationDoc[] | undefined;
}

export interface FdaProduct {
  brand_name?: string | undefined;
  dosage_form?: string | undefined;
  route?: string | undefined;
  marketing_status?: string | undefined;
  active_ingredients?: { name?: string | undefined; strength?: string | undefined }[] | undefined;
}

export interface DrugsFdaRecord {
  application_number?: string | undefined;
  sponsor_name?: string | undefined;
  submissions?: FdaSubmission[] | undefined;
  products?: FdaProduct[] | undefined;
  openfda?: OpenFdaSection | undefined;
}

export type LabelRecord = {
  set_id?: string | undefined;
  id?: string | undefined;
  version?: string | undefined;
  effective_time?: string | undefined;
  openfda?: OpenFdaSection | undefined;
} & Partial<Record<string, unknown>>;

export interface FdaLabelSummary {
  set_id: string | null;
  effective_date: string | null;
  indication_excerpt: string | null;
  dailymed_url: string | null;
}

export interface FdaApplication {
  application_number: string;
  application_type: string;
  brand_names: string[];
  generic_names: string[];
  sponsor: string | null;
  in_drugs_at_fda: boolean;
  original_approval: {
    date: string;
    submission_class: string | null;
    review_priority: string | null;
    orphan: boolean;
  } | null;
  latest_approved_submission: { type: string; date: string; class: string | null } | null;
  marketing_status: string[];
  products: { brand_name: string | null; dosage_form: string | null; route: string | null; marketing_status: string | null; active_ingredients: string }[];
  approval_letter_url: string | null;
  latest_label_pdf_url: string | null;
  drugs_at_fda_url: string;
  label?: FdaLabelSummary;
  note?: string;
}

export const EMA_MEDICINE_FIELDS = [
  'category',
  'name_of_medicine',
  'ema_product_number',
  'medicine_status',
  'international_non_proprietary_name_common_name',
  'active_substance',
  'therapeutic_area_mesh',
  'atc_code_human',
  'therapeutic_indication',
  'conditional_approval',
  'exceptional_circumstances',
  'accelerated_assessment',
  'additional_monitoring',
  'advanced_therapy',
  'biosimilar',
  'generic',
  'orphan_medicine',
  'prime_priority_medicine',
  'marketing_authorisation_developer_applicant_holder',
  'european_commission_decision_date',
  'opinion_adopted_date',
  'withdrawal_of_application_date',
  'marketing_authorisation_date',
  'refusal_of_marketing_authorisation_date',
  'withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date',
  'suspension_of_marketing_authorisation_date',
  'medicine_url',
] as const;

/** An EMA medicines-file row: every field is text (`Yes`/`No` flags, `dd/mm/yyyy` dates). */
export type EmaMedicine = Partial<Record<(typeof EMA_MEDICINE_FIELDS)[number], string>>;

export interface EmaDataset {
  meta?: { total_records?: number | undefined; timestamp?: string | undefined } | undefined;
  data?: EmaMedicine[] | undefined;
}
