import { describe, expect, it } from "bun:test";
import { buildSystemPrompt } from "../orchestration/context/system-prompt";
import type { PlatformConfig } from "../mcp/platforms.config";
import type { MCPTool } from "../mcp/registry";
import { contextVersion } from "../orchestration/context/transcript";

const platforms: PlatformConfig[] = [
  { name: "pubmed", enabled: false, alwaysLoadedTools: ["search_pubmed"] },
  { name: "ensembl", enabled: true, alwaysLoadedTools: ["search_genes", "missing"] },
  { name: "chembl", enabled: true, alwaysLoadedTools: ["search_compounds"] },
];
const tool = (server: string, name: string): MCPTool => ({
  server, name, description: "Description of " + name, inputSchema: {}, available: true,
});
const catalog = [tool("ensembl", "search_genes"), tool("chembl", "search_compounds"), tool("pubmed", "search_pubmed"), tool("chembl", "get_activity")];

describe("system prompt capabilities", () => {
  it("uses only enabled platforms and catalog tools with an exact count", () => {
    const prompt = buildSystemPrompt(platforms, catalog);
    expect(prompt).toContain("access to 2 specialized databases");
    expect(prompt).toContain("You have 3 specialized tools available");
    expect(prompt).toContain("**chembl__search_compounds** - Drug/compound name → ChEMBL ID");
    expect(prompt).toContain("**ChEMBL** - Drug compounds, bioactivity, and pharmacology data");
    expect(prompt).toContain("**ensembl__search_genes**");
    expect(prompt).not.toContain("pubmed__search_pubmed");
    expect(prompt).not.toContain("ensembl__missing");
    expect(prompt).not.toContain("clinvar__lookup_by_rsid");
    expect(prompt).not.toContain("210+");
  });

  it("falls back to catalog descriptions for tools without a curated summary", () => {
    const prompt = buildSystemPrompt([{ name: "chembl", enabled: true, alwaysLoadedTools: ["get_activity"] }], catalog);
    expect(prompt).toContain("**chembl__get_activity** - Description of get_activity");
  });

  it("keeps prompt bytes and context version stable across discovery/config ordering", () => {
    const first = buildSystemPrompt(platforms, catalog);
    const reordered = buildSystemPrompt([...platforms].reverse(), [...catalog].reverse());
    expect(reordered).toBe(first);
    expect(contextVersion(first, {})).toBe(contextVersion(reordered, {}));
    const changed = buildSystemPrompt(platforms, catalog.slice(1));
    expect(contextVersion(changed, {})).not.toBe(contextVersion(first, {}));
  });
});
