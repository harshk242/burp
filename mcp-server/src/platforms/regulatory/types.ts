// Fields of openFDA and EMA records the handlers read; everything else is ignored.

export interface OpenFdaMeta {
  last_updated?: string;
  results?: { skip?: number; limit?: number; total?: number };
}

export interface OpenFdaResponse<T> {
  meta?: OpenFdaMeta;
  results?: T[];
  error?: { code?: string; message?: string };
}

export interface OpenFdaSection {
  application_number?: string[];
  brand_name?: string[];
  generic_name?: string[];
  manufacturer_name?: string[];
  product_type?: string[];
  route?: string[];
  substance_name?: string[];
}

export interface FdaApplicationDoc {
  url?: string;
  date?: string;
  type?: string;
}

export interface FdaSubmission {
  submission_type?: string;
  submission_number?: string;
  submission_status?: string;
  submission_status_date?: string;
  review_priority?: string;
  submission_class_code?: string;
  submission_class_code_description?: string;
  submission_property_type?: { code?: string }[];
  application_docs?: FdaApplicationDoc[];
}

export interface FdaProduct {
  brand_name?: string;
  dosage_form?: string;
  route?: string;
  marketing_status?: string;
  active_ingredients?: { name?: string; strength?: string }[];
}

export interface DrugsFdaRecord {
  application_number?: string;
  sponsor_name?: string;
  submissions?: FdaSubmission[];
  products?: FdaProduct[];
  openfda?: OpenFdaSection;
}

export type LabelRecord = {
  set_id?: string;
  id?: string;
  version?: string;
  effective_time?: string;
  openfda?: OpenFdaSection;
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

export interface EmaMedicine {
  category?: string;
  name_of_medicine?: string;
  ema_product_number?: string;
  medicine_status?: string;
  international_non_proprietary_name_common_name?: string;
  active_substance?: string;
  therapeutic_area_mesh?: string;
  atc_code_human?: string;
  therapeutic_indication?: string;
  conditional_approval?: string;
  exceptional_circumstances?: string;
  accelerated_assessment?: string;
  additional_monitoring?: string;
  advanced_therapy?: string;
  biosimilar?: string;
  generic?: string;
  orphan_medicine?: string;
  prime_priority_medicine?: string;
  marketing_authorisation_developer_applicant_holder?: string;
  european_commission_decision_date?: string;
  opinion_adopted_date?: string;
  withdrawal_of_application_date?: string;
  marketing_authorisation_date?: string;
  refusal_of_marketing_authorisation_date?: string;
  withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date?: string;
  suspension_of_marketing_authorisation_date?: string;
  medicine_url?: string;
}

export interface EmaDataset {
  meta?: { total_records?: number; timestamp?: string };
  data?: EmaMedicine[];
}
