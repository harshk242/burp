/**
 * The runner refuses to launch items unless tool search works the way it does
 * in production: tools available, search indexed, and a probe query that hits.
 * Without that, `search_available_tools` would return nothing and every item
 * would measure a broken agent.
 */
import type { ToolsReport } from "../../server/boot/tools";
import type { SearchState } from "./run-meta";

export const PROBE_QUERY = "clinvar variant";

/** A precondition failed before any item ran. */
export class RunAbort extends Error {}

export async function assertSearchReady(
  report: ToolsReport,
  probe: (query: string) => Promise<unknown[]>,
): Promise<{ search: SearchState; probeHits: number }> {
  if (report.toolsAvailable === 0) throw new RunAbort("no MCP tools available (is mcp-server built?)");
  if (!report.searchIndexed) throw new RunAbort("tool search is not indexed; refusing to run items");
  const hits = await probe(PROBE_QUERY);
  if (hits.length === 0) throw new RunAbort(`probe search "${PROBE_QUERY}" returned nothing; refusing to run items`);
  return {
    search: {
      tools_available: report.toolsAvailable,
      search_mode: report.embeddingsLoaded ? "hybrid" : "keyword",
      embedder: report.embeddingsLoaded ? report.embedder : null,
    },
    probeHits: hits.length,
  };
}
