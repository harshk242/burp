// Decoders for openFDA and EMA records: each reads the fields in ./types.ts from an untyped upstream value.
import { isRecord, optNumber, optRecord, optString, recordArray, stringArray, type JsonRecord } from '../../shared/json.js';
import {
  EMA_MEDICINE_FIELDS,
  type DrugsFdaRecord,
  type EmaDataset,
  type EmaMedicine,
  type FdaProduct,
  type FdaSubmission,
  type LabelRecord,
  type OpenFdaSection,
} from './types.js';

/** A string array, or `undefined` when the field is not an array. */
const strings = (value: unknown): string[] | undefined => (Array.isArray(value) ? stringArray(value) : undefined);

/** The object elements decoded, or `undefined` when the field is not an array. */
function records<T>(value: unknown, decode: (record: JsonRecord) => T): T[] | undefined {
  return Array.isArray(value) ? recordArray(value).map(decode) : undefined;
}

function openFdaSection(value: unknown): OpenFdaSection | undefined {
  const section = optRecord(value);
  if (!section) return undefined;
  return {
    application_number: strings(section.application_number),
    brand_name: strings(section.brand_name),
    generic_name: strings(section.generic_name),
    manufacturer_name: strings(section.manufacturer_name),
    product_type: strings(section.product_type),
    route: strings(section.route),
    substance_name: strings(section.substance_name),
  };
}

function submission(record: JsonRecord): FdaSubmission {
  return {
    submission_type: optString(record.submission_type),
    submission_number: optString(record.submission_number),
    submission_status: optString(record.submission_status),
    submission_status_date: optString(record.submission_status_date),
    review_priority: optString(record.review_priority),
    submission_class_code: optString(record.submission_class_code),
    submission_class_code_description: optString(record.submission_class_code_description),
    submission_property_type: records(record.submission_property_type, (property) => ({ code: optString(property.code) })),
    application_docs: records(record.application_docs, (doc) => ({
      url: optString(doc.url),
      date: optString(doc.date),
      type: optString(doc.type),
    })),
  };
}

function product(record: JsonRecord): FdaProduct {
  return {
    brand_name: optString(record.brand_name),
    dosage_form: optString(record.dosage_form),
    route: optString(record.route),
    marketing_status: optString(record.marketing_status),
    active_ingredients: records(record.active_ingredients, (ingredient) => ({
      name: optString(ingredient.name),
      strength: optString(ingredient.strength),
    })),
  };
}

export function decodeDrugsFdaRecord(record: JsonRecord): DrugsFdaRecord {
  return {
    application_number: optString(record.application_number),
    sponsor_name: optString(record.sponsor_name),
    submissions: records(record.submissions, submission),
    products: records(record.products, product),
    openfda: openFdaSection(record.openfda),
  };
}

/** Label sections (`indications_and_usage`, …) stay as they came; `sectionText` reads them. */
export function decodeLabelRecord(record: JsonRecord): LabelRecord {
  return {
    ...record,
    set_id: optString(record.set_id),
    id: optString(record.id),
    version: optString(record.version),
    effective_time: optString(record.effective_time),
    openfda: openFdaSection(record.openfda),
  };
}

function emaMedicine(record: JsonRecord): EmaMedicine {
  const medicine: EmaMedicine = {};
  for (const field of EMA_MEDICINE_FIELDS) {
    const value = optString(record[field]);
    if (value !== undefined) medicine[field] = value;
  }
  return medicine;
}

/** The EMA medicines file, or `undefined` when it has no `data` array. */
export function decodeEmaDataset(value: unknown): EmaDataset | undefined {
  if (!isRecord(value) || !Array.isArray(value.data)) return undefined;
  const meta = optRecord(value.meta);
  return {
    meta: meta && { total_records: optNumber(meta.total_records), timestamp: optString(meta.timestamp) },
    data: recordArray(value.data).map(emaMedicine),
  };
}
