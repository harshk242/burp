/**
 * Core search handler functions for ClinicalTrials.gov tools.
 *
 * Each handler receives a plain args object, calls the API via the shared
 * client helpers, and returns a raw result object (no MCP wrapping).
 */

import type { ToolHandler } from '../../../types.js';
import {
  fetchStudies,
  formatStudySummary,
  formatDetailedStudy,
  calculateStatistics,
} from '../client.js';

// ---------------------------------------------------------------------------
// search_studies
// ---------------------------------------------------------------------------

export const handleSearchStudies: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  if (args.query) params['query.term'] = args.query;
  if (args.condition) params['query.cond'] = args.condition;
  if (args.intervention) params['query.intr'] = args.intervention;
  if (args.location) params['query.locn'] = args.location;
  if (args.phase) params['filter.phase'] = args.phase;
  if (args.status) params['filter.overallStatus'] = args.status;
  if (args.sex) params['filter.sex'] = args.sex;
  if (args.age) params['filter.stdAge'] = args.age;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map(formatStudySummary),
  };
};

// ---------------------------------------------------------------------------
// get_study_details
// ---------------------------------------------------------------------------

export const handleGetStudyDetails: ToolHandler = async (args) => {
  const nctId = args.nctId as string;
  if (!nctId || !/^NCT\d{8}$/.test(nctId)) {
    throw new Error('Valid NCT ID is required (format: NCT########)');
  }

  const data = await fetchStudies({
    format: 'json',
    'query.term': nctId,
    'filter.ids': nctId,
    pageSize: 1,
  });

  if (!data.studies || data.studies.length === 0) {
    throw new Error(`No study found with NCT ID: ${nctId}`);
  }

  return formatDetailedStudy(data.studies[0]);
};

// ---------------------------------------------------------------------------
// search_by_location
// ---------------------------------------------------------------------------

export const handleSearchByLocation: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  let locationQuery = '';
  if (args.country) locationQuery += args.country;
  if (args.state) locationQuery += (locationQuery ? ', ' : '') + args.state;
  if (args.city) locationQuery += (locationQuery ? ', ' : '') + args.city;
  if (args.facilityName)
    locationQuery += (locationQuery ? ', ' : '') + args.facilityName;

  if (locationQuery) params['query.locn'] = locationQuery;
  if (args.distance && args.city) params['filter.distance'] = args.distance;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: { locationQuery, distance: args.distance },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      locations:
        study.protocolSection.contactsLocationsModule?.locations?.slice(0, 3) ||
        [],
    })),
  };
};

// ---------------------------------------------------------------------------
// search_by_condition
// ---------------------------------------------------------------------------

export const handleSearchByCondition: ToolHandler = async (args) => {
  if (!args.condition) {
    throw new Error('Condition parameter is required');
  }

  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
    'query.cond': args.condition,
  };

  if (args.phase) params['filter.phase'] = args.phase;
  if (args.recruitmentStatus)
    params['filter.overallStatus'] = args.recruitmentStatus;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      condition: args.condition,
      phase: args.phase,
      recruitmentStatus: args.recruitmentStatus,
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      conditions: study.protocolSection.conditionsModule?.conditions || [],
      eligibility: {
        sex: study.protocolSection.eligibilityModule?.sex || 'Unknown',
        minimumAge:
          study.protocolSection.eligibilityModule?.minimumAge || 'Not specified',
        maximumAge:
          study.protocolSection.eligibilityModule?.maximumAge || 'Not specified',
        healthyVolunteers:
          study.protocolSection.eligibilityModule?.healthyVolunteers || false,
      },
    })),
  };
};

// ---------------------------------------------------------------------------
// get_trial_statistics
// ---------------------------------------------------------------------------

export const handleGetTrialStatistics: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: 100,
  };

  const filters = args.filters as
    | Record<string, unknown>
    | undefined;
  if (filters?.condition) params['query.cond'] = filters.condition;
  if (filters?.phase) params['filter.phase'] = filters.phase;
  if (filters?.status) params['filter.overallStatus'] = filters.status;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    totalStudies: data.totalCount || 0,
    analyzedStudies: studies.length,
    groupBy: (args.groupBy as string) || 'none',
    filters: filters || {},
    statistics: calculateStatistics(studies, args.groupBy as string | undefined),
  };
};

// ---------------------------------------------------------------------------
// search_by_sponsor
// ---------------------------------------------------------------------------

export const handleSearchBySponsor: ToolHandler = async (args) => {
  if (!args.sponsor) {
    throw new Error('Sponsor parameter is required');
  }

  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
    'query.spons': args.sponsor,
  };

  if (args.sponsorType) params['filter.leadSponsorClass'] = args.sponsorType;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: { sponsor: args.sponsor, sponsorType: args.sponsorType },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      sponsorDetails:
        study.protocolSection.sponsorCollaboratorsModule?.leadSponsor,
    })),
  };
};

// ---------------------------------------------------------------------------
// search_by_intervention
// ---------------------------------------------------------------------------

export const handleSearchByIntervention: ToolHandler = async (args) => {
  if (!args.intervention) {
    throw new Error('Intervention parameter is required');
  }

  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
    'query.intr': args.intervention,
  };

  if (args.interventionType)
    params['filter.interventionType'] = args.interventionType;
  if (args.phase) params['filter.phase'] = args.phase;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      intervention: args.intervention,
      interventionType: args.interventionType,
      phase: args.phase,
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map(formatStudySummary),
  };
};

// ---------------------------------------------------------------------------
// get_recruiting_studies
// ---------------------------------------------------------------------------

export const handleGetRecruitingStudies: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
    'filter.overallStatus': 'RECRUITING',
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.location) params['query.locn'] = args.location;
  if (args.ageGroup) params['filter.stdAge'] = args.ageGroup;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      recruitmentStatus: 'RECRUITING',
      condition: args.condition,
      location: args.location,
      ageGroup: args.ageGroup,
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      eligibility: {
        sex: study.protocolSection.eligibilityModule?.sex || 'Unknown',
        minimumAge:
          study.protocolSection.eligibilityModule?.minimumAge || 'Not specified',
        maximumAge:
          study.protocolSection.eligibilityModule?.maximumAge || 'Not specified',
        healthyVolunteers:
          study.protocolSection.eligibilityModule?.healthyVolunteers || false,
      },
      locations:
        study.protocolSection.contactsLocationsModule?.locations?.slice(0, 2) ||
        [],
    })),
  };
};

// ---------------------------------------------------------------------------
// search_by_date_range
// ---------------------------------------------------------------------------

export const handleSearchByDateRange: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize as number) || 10,
  };

  if (args.startDateFrom)
    params['filter.studyStartDateFrom'] = args.startDateFrom;
  if (args.startDateTo) params['filter.studyStartDateTo'] = args.startDateTo;
  if (args.completionDateFrom)
    params['filter.primaryCompletionDateFrom'] = args.completionDateFrom;
  if (args.completionDateTo)
    params['filter.primaryCompletionDateTo'] = args.completionDateTo;
  if (args.condition) params['query.cond'] = args.condition;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      startDateFrom: args.startDateFrom,
      startDateTo: args.startDateTo,
      completionDateFrom: args.completionDateFrom,
      completionDateTo: args.completionDateTo,
      condition: args.condition,
    },
    totalCount: data.totalCount || 0,
    resultsShown: studies.length,
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      dates: {
        startDate: study.protocolSection.statusModule.startDateStruct?.date,
        primaryCompletionDate:
          study.protocolSection.statusModule.primaryCompletionDateStruct?.date,
      },
    })),
  };
};
