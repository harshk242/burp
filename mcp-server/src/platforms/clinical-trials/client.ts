import axios, { type AxiosAdapter, type AxiosInstance, type AxiosResponse } from 'axios';
import { UpstreamError } from '../../shared/exceptions.js';
import { getHeader } from '../../shared/http-retry-classify.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';

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
    armsInterventionsModule?: {
      interventions?: Array<{ name: string; type?: string }>;
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

export const CLINICAL_TRIALS_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 1,
  backoffMs: [0],
  totalBudgetMs: 40_000,
  perAttemptTimeoutMs: 30_000,
});

export const CLINICAL_TRIALS_BASE_URL = 'https://clinicaltrials.gov/api/v2';

export interface ClinicalTrialsClientOptions {
  policy?: RetryPolicy;
  adapter?: AxiosAdapter;
  retryDeps?: RetryDeps;
}

export function createClinicalTrialsClient(options: ClinicalTrialsClientOptions = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: CLINICAL_TRIALS_BASE_URL,
    timeout: 30_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ClinicalTrials-MCP-Unified/1.0.0',
    },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });
  return attachRetry(instance, options.policy ?? CLINICAL_TRIALS_POLICY, 'clinicaltrials', options.retryDeps);
}

let client: AxiosInstance | null = null;

export function getClient(): AxiosInstance {
  if (!client) {
    throw new Error('ClinicalTrials client not initialised. Call initClient() first.');
  }
  return client;
}

export function initClient(
  _env: Record<string, string | undefined>,
  options: ClinicalTrialsClientOptions = {},
): void {
  client = createClinicalTrialsClient(options);
}

export function resetClient(): void {
  client = null;
}

const MAX_API_MESSAGE_CHARS = 500;

function apiErrorMessage(cause: unknown): string | undefined {
  if (!axios.isAxiosError(cause) || !cause.response) return undefined;
  const { data, headers } = cause.response;
  let text: unknown;
  if (typeof data === 'string') {
    if (getHeader(headers, 'content-type')?.toLowerCase().startsWith('text/plain')) text = data;
  } else if (data && typeof data === 'object') {
    text = (data as { message?: unknown }).message;
  }
  if (typeof text !== 'string' || !text.trim()) return undefined;
  return text.trim().slice(0, MAX_API_MESSAGE_CHARS);
}

/**
 * `countTotal` is opt-in on the v2 API; without it `totalCount` is omitted.
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
    const apiMessage = error instanceof UpstreamError ? apiErrorMessage(error.cause) : undefined;
    if (!apiMessage) throw error;
    const upstream = error as UpstreamError;
    throw new UpstreamError(`ClinicalTrials API error: ${apiMessage}. ${upstream.message}`, {
      kind: upstream.kind,
      reason: upstream.reason,
      platform: upstream.platform,
      status: upstream.status,
      attempts: upstream.attempts,
      elapsedMs: upstream.elapsedMs,
      retryAfterMs: upstream.retryAfterMs,
      url: upstream.url,
      cause: upstream.cause,
    });
  }
}

export function resultMeta(data: StudySearchResponse, shown: number) {
  return {
    totalCount: data.totalCount ?? null,
    resultsShown: shown,
    hasMore: Boolean(data.nextPageToken),
  };
}

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
