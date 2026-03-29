import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type { PlatformModule, ToolHandler } from './types.js';

// Import all platform modules
import { platform as ensembl } from './platforms/ensembl/index.js';
import { platform as openTargets } from './platforms/open-targets/index.js';
import { platform as chembl } from './platforms/chembl/index.js';
import { platform as pubchem } from './platforms/pubchem/index.js';
import { platform as clinicalTrials } from './platforms/clinical-trials/index.js';
import { platform as reactome } from './platforms/reactome/index.js';
import { platform as pubmed } from './platforms/pubmed/index.js';
import { platform as clinvar } from './platforms/clinvar/index.js';
import { platform as clinpgx } from './platforms/clinpgx/index.js';
import { platform as uniprot } from './platforms/uniprot/index.js';

const PLATFORMS: PlatformModule[] = [
  ensembl,
  openTargets,
  chembl,
  pubchem,
  clinicalTrials,
  reactome,
  pubmed,
  clinvar,
  clinpgx,
  uniprot,
];

/** Build the combined tool list and handler map (prefixed with platform name) */
function buildToolRegistry(platforms: PlatformModule[]) {
  const allTools: Tool[] = [];
  const allHandlers = new Map<string, ToolHandler>();

  for (const p of platforms) {
    for (const tool of p.tools) {
      const prefixedName = `${p.name}__${tool.name}`;
      allTools.push({
        ...tool,
        name: prefixedName,
        description: `[${p.name}] ${tool.description ?? ''}`,
      });

      const handler = p.handlers[tool.name];
      if (handler) {
        allHandlers.set(prefixedName, handler);
      } else {
        console.error(`[WARN] Platform "${p.name}" has no handler for tool "${tool.name}"`);
      }
    }
  }

  return { allTools, allHandlers };
}

export function createServer(
  allTools: Tool[],
  allHandlers: Map<string, ToolHandler>,
): Server {
  const server = new Server(
    { name: 'bio-mcp-unified', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = allHandlers.get(name);

    if (!handler) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await handler(args ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function runServer(): Promise<void> {
  // Initialise every platform
  const env = process.env as Record<string, string | undefined>;
  for (const p of PLATFORMS) {
    try {
      p.init(env);
    } catch (err) {
      console.error(`[ERROR] Failed to init platform "${p.name}":`, err);
    }
  }

  const { allTools, allHandlers } = buildToolRegistry(PLATFORMS);
  console.error(`[INFO] Registered ${allTools.length} tools from ${PLATFORMS.length} platforms`);

  const server = createServer(allTools, allHandlers);
  const transport = new StdioServerTransport();

  const cleanup = () => {
    for (const p of PLATFORMS) {
      try { p.cleanup(); } catch { /* ignore */ }
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await server.connect(transport);
  console.error('[INFO] Bio MCP unified server running on stdio');
}
