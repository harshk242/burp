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

describe("evidence and regulatory rules", () => {
  const regulatory: PlatformConfig[] = [
    { name: "pubmed", enabled: true, alwaysLoadedTools: ["search_pubmed", "batch_fetch_articles"] },
    { name: "clinicaltrials", enabled: true, alwaysLoadedTools: [] },
    { name: "regulatory", enabled: true, alwaysLoadedTools: ["search_fda_approvals", "search_ema_medicines"] },
  ];
  const tools = [
    tool("pubmed", "search_pubmed"), tool("pubmed", "batch_fetch_articles"),
    tool("clinicaltrials", "get_study_details"),
    tool("regulatory", "search_fda_approvals"), tool("regulatory", "search_ema_medicines"), tool("regulatory", "get_fda_label"),
  ];

  it("tells the agent to open records before citing them, naming only tools that exist", () => {
    const prompt = buildSystemPrompt(regulatory, tools);
    expect(prompt).toContain("Search results are leads, not findings.");
    expect(prompt).toContain("pubmed__batch_fetch_articles with every PMID you will cite");
    expect(prompt).toContain("clinicaltrials__get_study_details for each NCT ID");
    expect(prompt).toContain("**pubmed__batch_fetch_articles** - PMIDs → abstracts");

    const withoutTrials = buildSystemPrompt(regulatory.filter((p) => p.name !== "clinicaltrials"), tools);
    expect(withoutTrials).not.toContain("clinicaltrials__get_study_details");
  });

  it("lists deferred tools by name but not the ones already loaded", () => {
    const prompt = buildSystemPrompt(regulatory, tools);
    expect(prompt).toContain("- **regulatory__get_fda_label** - FDA label text");
    expect(prompt).toContain("- **clinicaltrials__get_study_details** - one trial record by NCT ID");
    expect(prompt).not.toContain("- **pubmed__fetch_article_details**");
  });

  it("adds regulatory rules only when a regulatory tool is enabled", () => {
    const prompt = buildSystemPrompt(regulatory, tools);
    expect(prompt).toContain("## Regulatory Status");
    expect(prompt).toContain("check the regulator with these tools");
    expect(prompt).toContain("search by indication");
    expect(buildSystemPrompt(platforms, catalog)).not.toContain("## Regulatory Status");
  });
});
