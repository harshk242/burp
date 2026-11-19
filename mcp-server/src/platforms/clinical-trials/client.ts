import axios, { type AxiosAdapter, type AxiosInstance } from 'axios';
import { UpstreamError } from '../../shared/exceptions.js';
import { getHeader } from '../../shared/http-retry-classify.js';
import { attachRetry, type RetryDeps, type RetryPolicy } from '../../shared/http-retry.js';
import { optString, path } from '../../shared/json.js';
import { decodeStudySearchResponse, type Study, type StudySearchResponse } from './study.js';

export type { Study, StudySearchResponse } from './study.js';

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
  const data: unknown = cause.response.data;
  let text: string | undefined;
  if (typeof data === 'string') {
    if (getHeader(cause.response.headers, 'content-type')?.toLowerCase().startsWith('text/plain')) text = data;
  } else {
    text = optString(path(data, 'message'));
  }
  if (!text?.trim()) return undefined;
  return text.trim().slice(0, MAX_API_MESSAGE_CHARS);
}

/**
 * Query params accepted by `GET /studies` (API v2). The API rejects anything
 * else with HTTP 400, so field filters (phase, sex, age, dates, ...) must go
 * through `filter.advanced` — see advanced-filter.ts.
 */
export const STUDIES_PARAMS: ReadonlySet<string> = new Set([
  'format', 'markupFormat',
  'query.cond', 'query.term', 'query.locn', 'query.titles', 'query.intr',
  'query.outc', 'query.spons', 'query.lead', 'query.id', 'query.patient',
  'filter.overallStatus', 'filter.geo', 'filter.ids', 'filter.advanced', 'filter.synonyms',
  'postFilter.overallStatus', 'postFilter.geo', 'postFilter.ids',
  'postFilter.advanced', 'postFilter.synonyms',
  'aggFilters', 'geoDecay', 'fields', 'sort', 'countTotal', 'pageSize', 'pageToken',
]);

/**
 * `countTotal` is opt-in on the v2 API; without it `totalCount` is omitted.
 */
export async function fetchStudies(
  params: Record<string, unknown>,
): Promise<StudySearchResponse> {
  const unknown = Object.keys(params).filter((key) => !STUDIES_PARAMS.has(key));
  if (unknown.length) {
    throw new Error(`Unsupported ClinicalTrials.gov /studies params: ${unknown.join(', ')}`);
  }
  try {
    const response = await getClient().get<unknown>(
      '/studies',
      { params: { countTotal: true, ...params } },
    );
    return decodeStudySearchResponse(response.data);
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;
    const apiMessage = apiErrorMessage(error.cause);
    if (!apiMessage) throw error;
    const upstream = error;
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

/**
 * Trial names come only from the registry record, never from model memory: the acronym and
 * sponsor protocol ID let the caller check which NCT ID a named trial (e.g. ENGAGE) belongs to.
 */
function studyNames(study: Study) {
  const id = study.protocolSection.identificationModule;
  return {
    acronym: id.acronym ?? null,
    orgStudyId: id.orgStudyIdInfo?.id ?? null,
  };
}

export function formatStudySummary(study: Study) {
  return {
    nctId: study.protocolSection.identificationModule.nctId,
    ...studyNames(study),
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
    hasResults: study.hasResults ?? false,
  };
}

export function formatDetailedStudy(study: Study) {
  return {
    identification: {
      nctId: study.protocolSection.identificationModule.nctId,
      ...studyNames(study),
      secondaryIds:
        study.protocolSection.identificationModule.secondaryIdInfos?.map((info) => info.id) ?? [],
      briefTitle: study.protocolSection.identificationModule.briefTitle,
      officialTitle: study.protocolSection.identificationModule.officialTitle,
    },
    hasResults: study.hasResults ?? false,
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
    let value: string;

    switch (field) {
      case 'status':
        value = study.protocolSection.statusModule.overallStatus ?? 'Unknown';
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

    groups[value] = (groups[value] || 0) + 1;
  }

  return groups;
}
