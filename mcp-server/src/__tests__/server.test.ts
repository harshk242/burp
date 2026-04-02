import { describe, it, expect } from 'vitest';
import { buildToolRegistry, createServer } from '../server.js';
import type { PlatformModule } from '../types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlatform(name: string, toolNames: string[]): PlatformModule {
  return {
    name,
    tools: toolNames.map((n) => ({
      name: n,
      description: `${n} description`,
      inputSchema: { type: 'object', properties: {}, required: [] },
    })) as Tool[],
    handlers: Object.fromEntries(
      toolNames.map((n) => [n, async () => ({ tool: n, result: 'ok' })]),
    ),
    init: () => {},
    cleanup: () => {},
  };
}

// ── buildToolRegistry ─────────────────────────────────────────────────────────

describe('buildToolRegistry', () => {
  it('prefixes each tool name with "<platform>__"', () => {
    const { allTools } = buildToolRegistry([makePlatform('ensembl', ['lookup_gene'])]);
    expect(allTools[0].name).toBe('ensembl__lookup_gene');
  });

  it('augments tool description with "[<platform>] " prefix', () => {
    const { allTools } = buildToolRegistry([makePlatform('ensembl', ['lookup_gene'])]);
    expect(allTools[0].description).toBe('[ensembl] lookup_gene description');
  });

  it('registers handler under the prefixed name', () => {
    const { allHandlers } = buildToolRegistry([makePlatform('chembl', ['search_compounds'])]);
    expect(allHandlers.has('chembl__search_compounds')).toBe(true);
    expect(allHandlers.get('chembl__search_compounds')).toBeTypeOf('function');
  });

  it('aggregates tools and handlers from multiple platforms', () => {
    const p1 = makePlatform('a', ['t1', 't2']);
    const p2 = makePlatform('b', ['t3']);
    const { allTools, allHandlers } = buildToolRegistry([p1, p2]);
    expect(allTools).toHaveLength(3);
    expect(allHandlers.size).toBe(3);
    expect(allHandlers.has('a__t1')).toBe(true);
    expect(allHandlers.has('b__t3')).toBe(true);
  });

  it('returns empty collections for an empty platform list', () => {
    const { allTools, allHandlers } = buildToolRegistry([]);
    expect(allTools).toHaveLength(0);
    expect(allHandlers.size).toBe(0);
  });

  it('does not register a handler when platform.handlers is missing the entry', () => {
    const platform: PlatformModule = {
      name: 'broken',
      tools: [
        {
          name: 'ghost_tool',
          description: 'no handler',
          inputSchema: { type: 'object', properties: {} },
        } as Tool,
      ],
      handlers: {}, // intentionally empty
      init: () => {},
      cleanup: () => {},
    };
    // Should not throw — just omit the handler with a console warning
    expect(() => buildToolRegistry([platform])).not.toThrow();
    const { allHandlers } = buildToolRegistry([platform]);
    expect(allHandlers.has('broken__ghost_tool')).toBe(false);
  });

  it('invoked handler returns the platform result', async () => {
    const { allHandlers } = buildToolRegistry([makePlatform('test', ['ping'])]);
    const handler = allHandlers.get('test__ping')!;
    const result = await handler({});
    expect(result).toEqual({ tool: 'ping', result: 'ok' });
  });

  it('preserves inputSchema from original tool definition', () => {
    const platform: PlatformModule = {
      name: 'p',
      tools: [
        {
          name: 'foo',
          description: 'foo',
          inputSchema: {
            type: 'object',
            properties: { gene_id: { type: 'string' } },
            required: ['gene_id'],
          },
        } as Tool,
      ],
      handlers: { foo: async () => ({}) },
      init: () => {},
      cleanup: () => {},
    };
    const { allTools } = buildToolRegistry([platform]);
    expect(allTools[0].inputSchema).toEqual({
      type: 'object',
      properties: { gene_id: { type: 'string' } },
      required: ['gene_id'],
    });
  });
});

// ── createServer ──────────────────────────────────────────────────────────────

describe('createServer', () => {
  it('returns a Server instance without throwing', () => {
    const { allTools, allHandlers } = buildToolRegistry([makePlatform('test', ['foo'])]);
    expect(() => createServer(allTools, allHandlers)).not.toThrow();
  });

  it('creates a server that can be constructed with zero tools', () => {
    expect(() => createServer([], new Map())).not.toThrow();
  });
});
