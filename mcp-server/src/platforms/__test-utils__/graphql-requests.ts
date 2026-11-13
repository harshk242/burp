import { getOperationAST, getVariableValues, parse, validate, type GraphQLSchema } from 'graphql';
import { expect } from 'vitest';
import type { RecordedRequest } from './tool-requests.js';

export function assertGraphQLRequest(schema: GraphQLSchema, request: RecordedRequest) {
  const body = request.body as { query: string; variables?: Record<string, unknown> };
  const doc = parse(body.query);
  expect(validate(schema, doc).map((e) => e.message)).toEqual([]);
  const operation = getOperationAST(doc)!;
  const definitions = operation.variableDefinitions ?? [];
  const variables = body.variables ?? {};
  expect(Object.keys(variables).filter((key) => !definitions.some((d) => d.variable.name.value === key))).toEqual([]);
  const coerced = getVariableValues(schema, definitions, variables);
  expect('errors' in coerced ? coerced.errors?.map((e) => e.message) : []).toEqual([]);
}
