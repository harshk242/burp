import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';
import { getClient, isValidChemblIdArgs } from '../client.js';

export const tools: Tool[] = [
  {
    name: 'search_activities',
    description: 'Search bioactivity measurements and assay results',
    inputSchema: {
      type: 'object',
      properties: {
        target_chembl_id: { type: 'string', description: 'ChEMBL target ID filter' },
        assay_chembl_id: { type: 'string', description: 'ChEMBL assay ID filter' },
        molecule_chembl_id: { type: 'string', description: 'ChEMBL compound ID filter' },
        activity_type: { type: 'string', description: 'Activity type (e.g., IC50, Ki, EC50)' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: [],
    },
  },
  {
    name: 'get_assay_info',
    description: 'Get detailed information for a specific assay by ChEMBL assay ID',
    inputSchema: {
      type: 'object',
      properties: {
        chembl_id: { type: 'string', description: 'ChEMBL assay ID (e.g., CHEMBL1217643)' },
      },
      required: ['chembl_id'],
    },
  },
  {
    name: 'search_by_activity_type',
    description: 'Find bioactivity data by specific activity type and value range',
    inputSchema: {
      type: 'object',
      properties: {
        activity_type: { type: 'string', description: 'Activity type (e.g., IC50, Ki, EC50, Kd)' },
        min_value: { type: 'number', description: 'Minimum activity value' },
        max_value: { type: 'number', description: 'Maximum activity value' },
        units: { type: 'string', description: 'Units filter (e.g., nM, uM)' },
        limit: { type: 'number', description: 'Number of results to return (1-1000, default: 25)', minimum: 1, maximum: 1000 },
      },
      required: ['activity_type'],
    },
  },
  {
    name: 'get_dose_response',
    description: 'Get dose-response data and activity profiles for compounds',
    inputSchema: {
      type: 'object',
      properties: {
        molecule_chembl_id: { type: 'string', description: 'ChEMBL compound ID' },
        target_chembl_id: { type: 'string', description: 'ChEMBL target ID (optional filter)' },
      },
      required: ['molecule_chembl_id'],
    },
  },
  {
    name: 'compare_activities',
    description: 'Compare bioactivity data across multiple compounds or targets',
    inputSchema: {
      type: 'object',
      properties: {
        molecule_chembl_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of ChEMBL compound IDs (2-10)',
          minItems: 2,
          maxItems: 10,
        },
        target_chembl_id: { type: 'string', description: 'ChEMBL target ID for comparison' },
        activity_type: { type: 'string', description: 'Activity type for comparison' },
      },
      required: ['molecule_chembl_ids'],
    },
  },
];

async function handleSearchActivities(args: Record<string, unknown>) {
  const client = getClient();
  const params: Record<string, unknown> = { limit: (args.limit as number) || 25 };
  if (args.target_chembl_id) params.target_chembl_id = args.target_chembl_id;
  if (args.molecule_chembl_id) params.molecule_chembl_id = args.molecule_chembl_id;
  if (args.activity_type) params.standard_type = args.activity_type;

  const response = await client.get('/activity.json', { params });
  return response.data;
}

async function handleGetAssayInfo(args: Record<string, unknown>) {
  if (!isValidChemblIdArgs(args)) {
    throw new Error('Invalid arguments');
  }

  const client = getClient();
  const response = await client.get(`/assay/${args.chembl_id}.json`);
  return response.data;
}

async function handleSearchByActivityType(args: Record<string, unknown>) {
  if (!args || typeof args.activity_type !== 'string') {
    throw new Error('Invalid activity type arguments');
  }

  const client = getClient();
  const params: Record<string, unknown> = {
    standard_type: args.activity_type,
    limit: (args.limit as number) || 25,
  };

  if (args.min_value !== undefined) {
    params.standard_value__gte = args.min_value;
  }
  if (args.max_value !== undefined) {
    params.standard_value__lte = args.max_value;
  }
  if (args.units) {
    params.standard_units = args.units;
  }

  const response = await client.get('/activity.json', { params });
  return response.data;
}

async function handleGetDoseResponse(args: Record<string, unknown>) {
  if (!args || typeof args.molecule_chembl_id !== 'string') {
    throw new Error('Invalid dose response arguments');
  }

  const client = getClient();
  const params: Record<string, unknown> = {
    molecule_chembl_id: args.molecule_chembl_id,
    limit: 100,
  };

  if (args.target_chembl_id) {
    params.target_chembl_id = args.target_chembl_id;
  }

  const response = await client.get('/activity.json', { params });
  const activities = response.data.activities || [];

  const doseResponseData = activities
    .filter((a: any) => a.standard_value !== null && a.standard_type)
    .map((a: any) => ({
      assay_chembl_id: a.assay_chembl_id,
      target_chembl_id: a.target_chembl_id,
      activity_type: a.standard_type,
      value: a.standard_value,
      units: a.standard_units,
      relation: a.standard_relation,
    }));

  return {
    molecule_chembl_id: args.molecule_chembl_id,
    total_measurements: doseResponseData.length,
    dose_response_data: doseResponseData,
  };
}

async function handleCompareActivities(args: Record<string, unknown>) {
  if (!args || !Array.isArray(args.molecule_chembl_ids) || args.molecule_chembl_ids.length < 2) {
    throw new Error('Invalid activity comparison arguments');
  }

  const client = getClient();
  const comparisonResults = [];

  for (const chemblId of (args.molecule_chembl_ids as string[]).slice(0, 10)) {
    const params: Record<string, unknown> = {
      molecule_chembl_id: chemblId,
      limit: 50,
    };

    if (args.target_chembl_id) {
      params.target_chembl_id = args.target_chembl_id;
    }
    if (args.activity_type) {
      params.standard_type = args.activity_type;
    }

    try {
      const response = await client.get('/activity.json', { params });
      const activities = response.data.activities || [];
      comparisonResults.push({
        molecule_chembl_id: chemblId,
        activity_count: activities.length,
        activities: activities.slice(0, 20),
      });
    } catch (error) {
      comparisonResults.push({
        molecule_chembl_id: chemblId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    comparison_results: comparisonResults,
    target_filter: args.target_chembl_id,
    activity_type_filter: args.activity_type,
  };
}

export const handlers: Record<string, ToolHandler> = {
  search_activities: handleSearchActivities,
  get_assay_info: handleGetAssayInfo,
  search_by_activity_type: handleSearchByActivityType,
  get_dose_response: handleGetDoseResponse,
  compare_activities: handleCompareActivities,
};
