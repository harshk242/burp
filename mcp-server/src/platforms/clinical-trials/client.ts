/**
 * HTTP client and shared types for the ClinicalTrials.gov API (v2).
 */

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';

// ---------------------------------------------------------------------------
// API response interfaces
// ---------------------------------------------------------------------------

export interface StudySearchResponse {
  studies: Study[];
  /** Only present when the request sets `countTotal=true`. */
  totalCount?: number;
  nextPageToken?: string;
}

export interface Study {
  protocolSection: {
    identificationModule: {
      nctId: string;
      briefTitle: string;
      officialTitle?: string;
    };
    statusModule: {
      overallStatus: string;
      startDateStruct?: {
        date: string;
        type: string;
      };
      primaryCompletionDateStruct?: {
        date: string;
        type: string;
      };
    };
    sponsorCollaboratorsModule?: {
      leadSponsor: {
        name: string;
        class: string;
      };
    };
    conditionsModule?: {
      conditions: string[];
    };
    designModule?: {
      phases?: string[];
      studyType: string;
    };
    contactsLocationsModule?: {
      locations?: Array<{
        facility: string;
        city: string;
        state?: string;
        country: string;
      }>;
    };
    eligibilityModule?: {
      eligibilityCriteria: string;
      healthyVolunteers: boolean;
      sex: string;
      minimumAge?: string;
      maximumAge?: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Singleton axios client
// ---------------------------------------------------------------------------

const API_BASE_URL = 'https://clinicaltrials.gov/api/v2';

let client: AxiosInstance | null = null;

export function getClient(): AxiosInstance {
  if (!client) {
    throw new Error('ClinicalTrials client not initialised. Call initClient() first.');
  }
  return client;
}

export function initClient(_env: Record<string, string | undefined>): void {
  client = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ClinicalTrials-MCP-Unified/1.0.0',
    },
  });
}

export function cleanupClient(): void {
  client = null;
}

// ---------------------------------------------------------------------------
// Shared API helper
// ---------------------------------------------------------------------------

/**
 * Perform a GET to `/studies` with the given query params.
 * `countTotal` is opt-in on the v2 API; without it `totalCount` is omitted.
 * Throws on network / HTTP errors.
 */
export async function fetchStudies(
  params: Record<string, unknown>,
): Promise<StudySearchResponse> {
  try {
    const response: AxiosResponse<StudySearchResponse> = await getClient().get(
      '/studies',
      { params: { countTotal: true, ...params } },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const msg =
        (error.response?.data as { message?: string })?.message ?? error.message;
      throw new Error(`ClinicalTrials API error: ${msg}`);
    }
    throw error;
  }
}

/**
 * Count fields shared by every search result. `totalCount` is `null` when the
 * API did not report one, never a fabricated 0 or page size.
 */
export function resultMeta(data: StudySearchResponse, shown: number) {
  return {
    totalCount: data.totalCount ?? null,
    resultsShown: shown,
    hasMore: Boolean(data.nextPageToken),
  };
}

/**
 * Count fields for handlers that filter the API page locally, so the API total
 * describes the query before filtering, not the returned list.
 */
export function filteredResultMeta(
  data: StudySearchResponse,
  shown: number,
  filterDescription: string,
) {
  return {
    apiTotalCount: data.totalCount ?? null,
    resultsShown: shown,
    hasMore: Boolean(data.nextPageToken),
    countNote: `apiTotalCount is before ${filterDescription}; resultsShown is after filtering this page only`,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatStudySummary(study: Study) {
  return {
    nctId: study.protocolSection.identificationModule.nctId,
    title: study.protocolSection.identificationModule.briefTitle,
    status: study.protocolSection.statusModule.overallStatus,
    phase: study.protocolSection.designModule?.phases || ['Not specified'],
    studyType: study.protocolSection.designModule?.studyType || 'Unknown',
    sponsor:
      study.protocolSection.sponsorCollaboratorsModule?.leadSponsor?.name ||
      'Not specified',
    conditions:
      study.protocolSection.conditionsModule?.conditions?.slice(0, 3) || [],
    startDate:
      study.protocolSection.statusModule.startDateStruct?.date || 'Not specified',
  };
}

export function formatDetailedStudy(study: Study) {
  return {
    identification: {
      nctId: study.protocolSection.identificationModule.nctId,
      briefTitle: study.protocolSection.identificationModule.briefTitle,
      officialTitle: study.protocolSection.identificationModule.officialTitle,
    },
    status: {
      overallStatus: study.protocolSection.statusModule.overallStatus,
      startDate: study.protocolSection.statusModule.startDateStruct?.date,
      primaryCompletionDate:
        study.protocolSection.statusModule.primaryCompletionDateStruct?.date,
    },
    design: {
      studyType: study.protocolSection.designModule?.studyType,
      phases: study.protocolSection.designModule?.phases,
    },
    sponsor: study.protocolSection.sponsorCollaboratorsModule?.leadSponsor,
    conditions: study.protocolSection.conditionsModule?.conditions,
    eligibility: study.protocolSection.eligibilityModule,
    locations:
      study.protocolSection.contactsLocationsModule?.locations?.slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

export function calculateStatistics(studies: Study[], groupBy?: string) {
  if (!groupBy) {
    return {
      totalStudies: studies.length,
      byStatus: groupByField(studies, 'status'),
      byPhase: groupByField(studies, 'phase'),
      byStudyType: groupByField(studies, 'studyType'),
    };
  }
  return groupByField(studies, groupBy);
}

function groupByField(studies: Study[], field: string) {
  const groups: Record<string, number> = {};

  for (const study of studies) {
    let value: string | string[];

    switch (field) {
      case 'status':
        value = study.protocolSection.statusModule.overallStatus;
        break;
      case 'phase':
        value =
          study.protocolSection.designModule?.phases?.[0] || 'Not specified';
        break;
      case 'studyType':
        value = study.protocolSection.designModule?.studyType || 'Unknown';
        break;
      case 'condition':
        value =
          study.protocolSection.conditionsModule?.conditions?.[0] ||
          'Not specified';
        break;
      case 'sponsor':
        value =
          study.protocolSection.sponsorCollaboratorsModule?.leadSponsor?.name ||
          'Not specified';
        break;
      default:
        value = 'Unknown';
    }

    const key = Array.isArray(value) ? value[0] : value;
    groups[key] = (groups[key] || 0) + 1;
  }

  return groups;
}
