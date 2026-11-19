import type { ToolHandler } from '../../../types.js';
import { optionalString } from '../../../shared/args.js';
import { optRecord } from '../../../shared/json.js';
import {
  fetchStudies,
  formatStudySummary,
  formatDetailedStudy,
  calculateStatistics,
  resultMeta,
} from '../client.js';
import { applyAdvancedFilter, area, range, sexEligible } from '../advanced-filter.js';

export const handleSearchStudies: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize) || 10,
  };

  if (args.query) params['query.term'] = args.query;
  if (args.condition) params['query.cond'] = args.condition;
  if (args.intervention) params['query.intr'] = args.intervention;
  if (args.location) params['query.locn'] = args.location;
  if (args.status) params['filter.overallStatus'] = args.status;
  applyAdvancedFilter(params, [
    area('Phase', args.phase),
    sexEligible(args.sex),
    area('StdAge', args.age),
  ]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    ...resultMeta(data, studies.length),
    studies: studies.map(formatStudySummary),
  };
};

export const handleGetStudyDetails: ToolHandler = async (args) => {
  const nctId = args.nctId;
  if (typeof nctId !== 'string' || !/^NCT\d{8}$/.test(nctId)) {
    throw new Error('Valid NCT ID is required (format: NCT########)');
  }

  const data = await fetchStudies({
    format: 'json',
    'query.term': nctId,
    'filter.ids': nctId,
    pageSize: 1,
  });

  const study = data.studies?.[0];
  if (!study) {
    throw new Error(`No study found with NCT ID: ${nctId}`);
  }

  return formatDetailedStudy(study);
};

export const handleSearchByLocation: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize) || 10,
  };

  const locationParts = [args.country, args.state, args.city, args.facilityName];
  if (locationParts.some((part) => part !== undefined && typeof part !== 'string')) {
    throw new Error('country, state, city and facilityName must be strings');
  }
  const locationQuery = locationParts.filter(Boolean).join(', ');

  if (locationQuery) params['query.locn'] = locationQuery;

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: { locationQuery },
    ...resultMeta(data, studies.length),
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      locations:
        study.protocolSection.contactsLocationsModule?.locations?.slice(0, 3) ||
        [],
    })),
  };
};

export const handleSearchByCondition: ToolHandler = async (args) => {
  if (!args.condition) {
    throw new Error('Condition parameter is required');
  }

  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize) || 10,
    'query.cond': args.condition,
  };

  if (args.recruitmentStatus)
    params['filter.overallStatus'] = args.recruitmentStatus;
  applyAdvancedFilter(params, [area('Phase', args.phase)]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      condition: args.condition,
      phase: args.phase,
      recruitmentStatus: args.recruitmentStatus,
    },
    ...resultMeta(data, studies.length),
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

export const handleGetTrialStatistics: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: 100,
  };

  const filters = optRecord(args.filters);
  const groupBy = optionalString(args, 'groupBy');
  if (filters?.condition) params['query.cond'] = filters.condition;
  if (filters?.status) params['filter.overallStatus'] = filters.status;
  applyAdvancedFilter(params, [area('Phase', filters?.phase)]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    totalStudies: data.totalCount ?? null,
    analyzedStudies: studies.length,
    note: `statistics are computed from a sample of the first ${studies.length} matching studies, not all totalStudies`,
    groupBy: groupBy || 'none',
    filters: filters || {},
    statistics: calculateStatistics(studies, groupBy),
  };
};

export const handleSearchBySponsor: ToolHandler = async (args) => {
  if (!args.sponsor) {
    throw new Error('Sponsor parameter is required');
  }

  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize) || 10,
    'query.spons': args.sponsor,
  };

  applyAdvancedFilter(params, [area('LeadSponsorClass', args.sponsorType)]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: { sponsor: args.sponsor, sponsorType: args.sponsorType },
    ...resultMeta(data, studies.length),
    studies: studies.map((study) => ({
      ...formatStudySummary(study),
      sponsorDetails:
        study.protocolSection.sponsorCollaboratorsModule?.leadSponsor,
    })),
  };
};

export const handleSearchByIntervention: ToolHandler = async (args) => {
  if (!args.intervention) {
    throw new Error('Intervention parameter is required');
  }

  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize) || 10,
    'query.intr': args.intervention,
  };

  applyAdvancedFilter(params, [
    area('InterventionType', args.interventionType),
    area('Phase', args.phase),
  ]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      intervention: args.intervention,
      interventionType: args.interventionType,
      phase: args.phase,
    },
    ...resultMeta(data, studies.length),
    studies: studies.map(formatStudySummary),
  };
};

export const handleGetRecruitingStudies: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize) || 10,
    'filter.overallStatus': 'RECRUITING',
  };

  if (args.condition) params['query.cond'] = args.condition;
  if (args.location) params['query.locn'] = args.location;
  applyAdvancedFilter(params, [area('StdAge', args.ageGroup)]);

  const data = await fetchStudies(params);
  const studies = data.studies || [];

  return {
    searchCriteria: {
      recruitmentStatus: 'RECRUITING',
      condition: args.condition,
      location: args.location,
      ageGroup: args.ageGroup,
    },
    ...resultMeta(data, studies.length),
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

export const handleSearchByDateRange: ToolHandler = async (args) => {
  const params: Record<string, unknown> = {
    format: 'json',
    pageSize: (args.pageSize) || 10,
  };

  applyAdvancedFilter(params, [
    range('StartDate', args.startDateFrom, args.startDateTo),
    range('PrimaryCompletionDate', args.completionDateFrom, args.completionDateTo),
  ]);
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
    ...resultMeta(data, studies.length),
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
