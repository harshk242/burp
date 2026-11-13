import { readFileSync } from 'node:fs';
import { buildClientSchema } from 'graphql';
import { describe, it } from 'vitest';
import { initializeClient, closeClient } from '../client.js';
import { toolDefinitions as tools, toolHandlers as handlers } from '../tools.js';
import { assertArgsAffectRequests, assertHandlerCoverage, assertMakesRequest, requestRecorder } from '../../__test-utils__/tool-requests.js';
import { assertGraphQLRequest } from '../../__test-utils__/graphql-requests.js';
import { argVariants, samples, clientSideArgs } from './tool-args.js';

const schema = buildClientSchema(JSON.parse(readFileSync(new URL('../../__test-utils__/fixtures/open-targets/schema.json', import.meta.url), 'utf8')));
async function capture(name: string, args: Record<string, unknown>) {
  const recorder = requestRecorder();
  initializeClient({ adapter: recorder.adapter });
  try { await handlers[name](args); } finally { closeClient(); }
  assertMakesRequest(recorder.requests);
  return recorder.requests;
}
it('has one handler for every tool', () => assertHandlerCoverage(tools, handlers));
describe.each(tools)('$name requests', (tool) => {
  it.each(argVariants(tool))('$label validates against the schema snapshot', async ({ args }) => {
    for (const request of await capture(tool.name, args)) assertGraphQLRequest(schema, request);
  });
  it('uses every argument and enum value', async () => {
    await assertArgsAffectRequests(tool, samples, (args) => capture(tool.name, args), clientSideArgs[tool.name]);
  });
});
