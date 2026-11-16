import { readFileSync } from 'node:fs';
import axios from 'axios';
import { buildClientSchema, lexicographicSortSchema, printSchema } from 'graphql';
import { afterAll, describe, expect, it } from 'vitest';
import { closeClient, createOpenTargetsHttp, initializeClient } from '../client.js';
import { toolDefinitions as tools, toolHandlers as handlers } from '../tools.js';
import { fetchGraphQLSchema } from '../../__test-utils__/graphql-nullability.js';
import { pace } from '../../__test-utils__/tool-requests.js';
import { argVariants } from './tool-args.js';

const snapshot = buildClientSchema(JSON.parse(readFileSync(new URL('../../__test-utils__/fixtures/open-targets/schema.json', import.meta.url), 'utf8')));
const canonical = (schema: typeof snapshot) => printSchema(lexicographicSortSchema(schema));
const transport = axios.getAdapter(axios.defaults.adapter);
afterAll(() => closeClient());
it('matches the saved schema snapshot (including additions and enum changes)', async () => {
  expect(canonical(await fetchGraphQLSchema(createOpenTargetsHttp()))).toBe(canonical(snapshot));
});
describe.each(tools)('$name live handler', (tool) => {
  it.each(argVariants(tool))('$label is accepted', async ({ args }) => {
    // Reset cache for each variant; pace each HTTP request, including multi-request handlers.
    let requests = 0;
    initializeClient({ adapter: async (config) => {
      await pace(500);
      requests++;
      const response = await transport(config);
      const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      expect(body.errors ?? []).toEqual([]);
      return response;
    } });
    const result = await handlers[tool.name]!(args);
    expect(result).toBeDefined();
    for (const root of ['target', 'disease', 'drug', 'variant', 'study', 'credibleSet']) {
      if (result && typeof result === 'object' && root in result) {
        expect((result as Record<string, unknown>)[root], root).not.toBeNull();
      }
    }
    expect(requests).toBeGreaterThan(0);
    closeClient();
  });
});
