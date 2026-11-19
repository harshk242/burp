/**
 * The `GET /studies` response, narrowed from `unknown` at the boundary. Only the fields the handlers
 * read are typed; objects the tools return as-is (lead sponsor, eligibility module, locations) keep
 * their other upstream fields.
 */
import {
  asRecord,
  optBoolean,
  optNumber,
  optRecord,
  optString,
  recordArray,
  stringArray,
  type JsonRecord,
} from '../../shared/json.js';

export interface StudySearchResponse {
  studies: Study[];
  /** Only present when the request sets `countTotal=true`. */
  totalCount?: number | undefined;
  nextPageToken?: string | undefined;
}

interface DateStruct {
  date?: string | undefined;
  type?: string | undefined;
}

export type LeadSponsor = JsonRecord & { name?: string | undefined; class?: string | undefined };

export type StudyLocation = JsonRecord & {
  facility?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  country?: string | undefined;
};

export type EligibilityModule = JsonRecord & {
  eligibilityCriteria?: string | undefined;
  healthyVolunteers?: boolean | undefined;
  sex?: string | undefined;
  minimumAge?: string | undefined;
  maximumAge?: string | undefined;
};

export interface Study {
  hasResults?: boolean | undefined;
  protocolSection: {
    identificationModule: {
      nctId?: string | undefined;
      briefTitle?: string | undefined;
      officialTitle?: string | undefined;
      /** Registry trial name, e.g. "ENGAGE". The only registry-backed name for an NCT ID. */
      acronym?: string | undefined;
      orgStudyIdInfo?: { id?: string | undefined } | undefined;
      secondaryIdInfos?: Array<{ id?: string | undefined; type?: string | undefined }> | undefined;
    };
    statusModule: {
      overallStatus?: string | undefined;
      startDateStruct?: DateStruct | undefined;
      primaryCompletionDateStruct?: DateStruct | undefined;
    };
    sponsorCollaboratorsModule?: { leadSponsor?: LeadSponsor | undefined } | undefined;
    armsInterventionsModule?: {
      interventions?: Array<{ name?: string | undefined; type?: string | undefined }> | undefined;
    } | undefined;
    conditionsModule?: { conditions?: string[] | undefined } | undefined;
    designModule?: { phases?: string[] | undefined; studyType?: string | undefined } | undefined;
    contactsLocationsModule?: { locations?: StudyLocation[] | undefined } | undefined;
    eligibilityModule?: EligibilityModule | undefined;
  };
}

/** The elements of an array field, or `undefined` when the field is absent (so `?? default` still applies). */
function optList<T>(value: unknown, decode: (raw: JsonRecord) => T): T[] | undefined {
  return Array.isArray(value) ? recordArray(value).map(decode) : undefined;
}

function optStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? stringArray(value) : undefined;
}

function decodeDate(value: unknown): DateStruct | undefined {
  const raw = optRecord(value);
  return raw && { date: optString(raw.date), type: optString(raw.type) };
}

function decodeLeadSponsor(raw: JsonRecord): LeadSponsor {
  return { ...raw, name: optString(raw.name), class: optString(raw.class) };
}

function decodeLocation(raw: JsonRecord): StudyLocation {
  return {
    ...raw,
    facility: optString(raw.facility),
    city: optString(raw.city),
    state: optString(raw.state),
    country: optString(raw.country),
  };
}

function decodeEligibility(raw: JsonRecord): EligibilityModule {
  return {
    ...raw,
    eligibilityCriteria: optString(raw.eligibilityCriteria),
    healthyVolunteers: optBoolean(raw.healthyVolunteers),
    sex: optString(raw.sex),
    minimumAge: optString(raw.minimumAge),
    maximumAge: optString(raw.maximumAge),
  };
}

function decodeStudy(raw: JsonRecord): Study {
  const section = asRecord(raw.protocolSection);
  const id = asRecord(section.identificationModule);
  const status = asRecord(section.statusModule);
  const orgStudyIdInfo = optRecord(id.orgStudyIdInfo);
  const sponsors = optRecord(section.sponsorCollaboratorsModule);
  const arms = optRecord(section.armsInterventionsModule);
  const conditions = optRecord(section.conditionsModule);
  const design = optRecord(section.designModule);
  const contacts = optRecord(section.contactsLocationsModule);
  const eligibility = optRecord(section.eligibilityModule);
  const leadSponsor = optRecord(sponsors?.leadSponsor);

  return {
    hasResults: optBoolean(raw.hasResults),
    protocolSection: {
      identificationModule: {
        nctId: optString(id.nctId),
        briefTitle: optString(id.briefTitle),
        officialTitle: optString(id.officialTitle),
        acronym: optString(id.acronym),
        orgStudyIdInfo: orgStudyIdInfo && { id: optString(orgStudyIdInfo.id) },
        secondaryIdInfos: optList(id.secondaryIdInfos, (info) => ({
          id: optString(info.id),
          type: optString(info.type),
        })),
      },
      statusModule: {
        overallStatus: optString(status.overallStatus),
        startDateStruct: decodeDate(status.startDateStruct),
        primaryCompletionDateStruct: decodeDate(status.primaryCompletionDateStruct),
      },
      sponsorCollaboratorsModule: sponsors && { leadSponsor: leadSponsor && decodeLeadSponsor(leadSponsor) },
      armsInterventionsModule: arms && {
        interventions: optList(arms.interventions, (item) => ({
          name: optString(item.name),
          type: optString(item.type),
        })),
      },
      conditionsModule: conditions && { conditions: optStrings(conditions.conditions) },
      designModule: design && { phases: optStrings(design.phases), studyType: optString(design.studyType) },
      contactsLocationsModule: contacts && { locations: optList(contacts.locations, decodeLocation) },
      eligibilityModule: eligibility && decodeEligibility(eligibility),
    },
  };
}

export function decodeStudySearchResponse(data: unknown): StudySearchResponse {
  const body = asRecord(data);
  return {
    studies: recordArray(body.studies).map(decodeStudy),
    totalCount: optNumber(body.totalCount),
    nextPageToken: optString(body.nextPageToken),
  };
}
