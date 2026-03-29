import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type { PlatformModule, ToolHandler } from './types.js';

// ── Layer 1 of 3: Prevent process death (5MB) ──────────────────────
//
// Tool output flows through three size guardrails, each with a distinct job:
//
//   MCP server  (5MB)  → prevent process death / stdio pressure
//       ↓
//   App manager (1MB)  → prevent LLM context blow-up
//       ↓
//   handleLargeOutput (15K) → noise reduce, then artifact if still big
//
// This layer is the coarsest — set high so it only fires on genuinely
// pathological responses (e.g. size=10000). No silent truncation: data
// is either sent intact or explicitly rejected with a structured error.
const SERVER_HARD_CAP_BYTES = parseInt(
  process.env.MCP_SERVER_HARD_CAP_BYTES ?? '5242880',
  10,
);

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
      const serialized = JSON.stringify(result, null, 2);
      const sizeBytes = Buffer.byteLength(serialized, 'utf-8');

      // Crash-prevention guard: reject before sending over stdio.
      // This prevents multi-MB payloads from pressuring transport/memory.
      // NOT silent truncation — returns an explicit error with diagnostics.
      if (sizeBytes > SERVER_HARD_CAP_BYTES) {
        const actualMB = (sizeBytes / 1024 / 1024).toFixed(2);
        const capMB = (SERVER_HARD_CAP_BYTES / 1024 / 1024).toFixed(1);
        console.error(
          `[WARN] Tool "${name}" output ${actualMB}MB exceeds server hard cap ${capMB}MB — returning error instead`,
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'output_too_large',
              tool: name,
              output_bytes: sizeBytes,
              cap_bytes: SERVER_HARD_CAP_BYTES,
              message: `Tool "${name}" returned ${actualMB}MB which exceeds the server-side ${capMB}MB safety cap. The data was NOT truncated — nothing was sent. To fix: use more specific query parameters (e.g., smaller 'size', narrower filters) to reduce the result set.`,
            }),
          }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: serialized }],
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
  // Filter platforms based on ENABLED_PLATFORMS env var from the app.
  // If not set, all platforms are enabled (backwards-compatible default).
  const enabledNames = process.env.ENABLED_PLATFORMS
    ? new Set(process.env.ENABLED_PLATFORMS.split(',').map((s: string) => s.trim()).filter(Boolean))
    : null;

  const activePlatforms = enabledNames
    ? PLATFORMS.filter((p) => enabledNames.has(p.name))
    : PLATFORMS;

  if (enabledNames) {
    const skipped = PLATFORMS.filter((p) => !enabledNames.has(p.name)).map((p) => p.name);
    if (skipped.length > 0) {
      console.error(`[INFO] Skipping disabled platforms: ${skipped.join(', ')}`);
    }
  }

  // Initialise only active platforms
  const env = process.env as Record<string, string | undefined>;
  for (const p of activePlatforms) {
    try {
      p.init(env);
    } catch (err) {
      console.error(`[ERROR] Failed to init platform "${p.name}":`, err);
    }
  }

  const { allTools, allHandlers } = buildToolRegistry(activePlatforms);
  console.error(`[INFO] Registered ${allTools.length} tools from ${activePlatforms.length} platforms`);

  const server = createServer(allTools, allHandlers);
  const transport = new StdioServerTransport();

  const cleanup = () => {
    for (const p of activePlatforms) {
      try { p.cleanup(); } catch { /* ignore */ }
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await server.connect(transport);
  console.error('[INFO] Bio MCP unified server running on stdio');
}
