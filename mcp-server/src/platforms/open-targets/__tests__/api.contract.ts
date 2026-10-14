import { beforeAll, describe, it } from 'vitest';
import type { GraphQLSchema } from 'graphql';
import {
  collectNullablePaths,
  fetchGraphQLSchema,
} from '../../__test-utils__/graphql-nullability.js';
import { assertSchemaStable } from '../../__test-utils__/schema-validator.js';
import { OPEN_TARGETS_POLICY, createOpenTargetsHttp } from '../client.js';
import {
  DRUG_CROSS_REFERENCES_OPERATION,
  DRUG_INFO_OPERATION,
} from '../tools/drug/operations.js';
import {
  DISEASE_INFO_OPERATION,
  DEFAULT_SEARCH_ENTITY_NAMES,
  SEARCH_ENTITIES_OPERATION,
} from '../tools/operations.js';
import {
  TARGET_ASSOCIATED_DISEASES_OPERATION,
  TARGET_INFO_OPERATION,
} from '../tools/target/operations.js';

const OPEN_TARGETS_CONTRACT_TIMEOUT_MS = 150_000;

const CONTRACT_OVERRIDES = {
  maxAttempts: 4,
  backoffMs: [2_000, 5_000, 10_000],
  totalBudgetMs: 120_000,
  jitter: 0,
};

const http = createOpenTargetsHttp({ policy: { ...OPEN_TARGETS_POLICY, ...CONTRACT_OVERRIDES } });

async function query(gql: string, variables: Record<string, unknown>): Promise<unknown> {
  const res = await http.post('', { query: gql, variables });
  // Open Targets returns errors in res.data.errors even with HTTP 200
  if (res.data.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(res.data.errors)}`);
  }
  return res.data.data;
}

let schema: GraphQLSchema | undefined;

function nullable(operation: string): { nullablePaths?: Set<string> } {
  return schema ? { nullablePaths: collectNullablePaths(schema, operation) } : {};
}

function openTargetsContractTest(name: string, test: () => Promise<void>): void {
  it(name, { timeout: OPEN_TARGETS_CONTRACT_TIMEOUT_MS, retry: 0 }, test);
}

describe('Open Targets GraphQL API Contracts', () => {
  beforeAll(async () => {
    try {
      schema = await fetchGraphQLSchema(http);
    } catch (error) {
      console.warn(`[CONTRACT] Introspection unavailable, null drift will fail strictly: ${error}`);
    }
  }, OPEN_TARGETS_CONTRACT_TIMEOUT_MS);

  openTargetsContractTest('target(ensemblId) schema is stable (BRAF)', async () => {
    const data = await query(TARGET_INFO_OPERATION, { ensemblId: 'ENSG00000157764' });
    await assertSchemaStable(
      'open-targets/target-info.schema.json',
      data,
      nullable(TARGET_INFO_OPERATION),
    );
  });

  openTargetsContractTest('disease(efoId) schema is stable (cancer)', async () => {
    const data = await query(DISEASE_INFO_OPERATION, { efoId: 'EFO_0000311' });
    await assertSchemaStable(
      'open-targets/disease-info.schema.json',
      data,
      nullable(DISEASE_INFO_OPERATION),
    );
  });

  openTargetsContractTest('drug(chemblId) schema is stable (Aspirin)', async () => {
    const data = await query(DRUG_INFO_OPERATION, { chemblId: 'CHEMBL25' });
    await assertSchemaStable(
      'open-targets/drug-info.schema.json',
      data,
      nullable(DRUG_INFO_OPERATION),
    );
  });

  openTargetsContractTest('drug crossReferences schema is stable (Aspirin)', async () => {
    const data = await query(DRUG_CROSS_REFERENCES_OPERATION, { chemblId: 'CHEMBL25' });
    await assertSchemaStable(
      'open-targets/drug-cross-references.schema.json',
      data,
      nullable(DRUG_CROSS_REFERENCES_OPERATION),
    );
  });

  openTargetsContractTest('target associatedDiseases schema is stable (BRAF)', async () => {
    const data = await query(TARGET_ASSOCIATED_DISEASES_OPERATION, {
      ensemblId: 'ENSG00000157764',
      pageIndex: 0,
      pageSize: 10,
    });
    await assertSchemaStable(
      'open-targets/target-associated-diseases.schema.json',
      data,
      nullable(TARGET_ASSOCIATED_DISEASES_OPERATION),
    );
  });

  openTargetsContractTest('search schema is stable (BRCA2 query)', async () => {
    const data = await query(SEARCH_ENTITIES_OPERATION, {
      queryString: 'BRCA2',
      entityNames: DEFAULT_SEARCH_ENTITY_NAMES,
      pageIndex: 0,
      pageSize: 10,
    });
    await assertSchemaStable(
      'open-targets/search.schema.json',
      data,
      nullable(SEARCH_ENTITIES_OPERATION),
    );
  });
});
