import { enabledPlatforms, type PlatformConfig } from "../../mcp/platforms.config";
import { toolRegistry, type MCPTool } from "../../mcp/registry";

const PLATFORM_SUMMARIES: Record<string, string> = {
  chembl: "**ChEMBL** - Drug compounds, bioactivity, and pharmacology data",
  pubchem: "**PubChem** - Chemical structures, properties, and bioassays",
  ensembl: "**Ensembl** - Genomic sequences, gene annotations, and variants",
  clinvar: "**ClinVar** - Clinical significance of genetic variants",
  "open-targets": "**Open Targets** - Drug-target associations and disease evidence",
  reactome: "**Reactome** - Biological pathways and reactions",
  clinicaltrials: "**ClinicalTrials** - Clinical trial registrations and results",
  pubmed: "**PubMed** - Biomedical literature and abstracts",
  clinpgx: "**ClinPGx (PharmGKB)** - Pharmacogenomics data",
  uniprot: "**UniProt** - Reviewed protein search summaries; focused annotations and sequence tools",
  regulatory: "**Regulatory** - FDA approvals and drug labels (openFDA) and EU authorisations (EMA)",
};

const CORE_TOOL_SUMMARIES: Record<string, string> = {
  ensembl__search_genes: "Convert gene symbols (TP53, BRCA1) → Ensembl IDs (ENSG...)",
  "open-targets__search_entities": "Find genes/diseases → ENSG/EFO IDs (main hub)",
  uniprot__search_by_gene: "Gene symbol → reviewed protein summaries and accessions (human by default); use entry tools for details",
  ensembl__get_xrefs: "Ensembl → UniProt/HGNC cross-references",
  chembl__search_compounds: "Drug/compound name → ChEMBL ID",
  pubchem__search_by_smiles: "SMILES structure → PubChem CID",
  clinvar__lookup_by_rsid: "rsID → clinical significance and gene",
  pubmed__search_pubmed: "Literature search → PMIDs with titles (leads, not findings)",
  pubmed__batch_fetch_articles: "PMIDs → abstracts (read before citing a finding)",
  clinicaltrials__search_by_intervention: "Drug → clinical trials (NCT IDs)",
  clinicaltrials__search_by_condition: "Condition → clinical trials (NCT IDs)",
  regulatory__search_fda_approvals: "Drug, indication or date window → FDA approvals with dates",
  regulatory__search_ema_medicines: "Medicine or therapeutic area → EU (EMA) authorisation status and dates",
};

/** Deferred tools the agent most often wrongly assumed did not exist; named so it searches for them. */
const ON_DEMAND_TOOLS: Record<string, string> = {
  clinicaltrials__get_study_details: "one trial record by NCT ID",
  clinicaltrials__get_studies_with_results: "trials with posted results",
  pubmed__fetch_article_details: "full paper record (MeSH terms, grants)",
  regulatory__get_fda_label: "FDA label text: boxed warning, indications, contraindications, dosing",
  "open-targets__get_drug_warnings": "drug warnings and withdrawals",
  "open-targets__get_target_safety_information": "target safety liabilities",
  "open-targets__get_target_tractability": "target tractability",
  chembl__get_mechanism_of_action: "drug mechanism of action",
  ensembl__get_transcripts: "gene transcripts",
  clinvar__lookup_by_coordinates: "variants at a genomic position",
  clinpgx__get_guidelines_for_pair: "CPIC/DPWG guideline for a gene-drug pair",
};

const ID_RESOLUTION_PATTERNS: Record<string, string> = {
  ensembl__search_genes: '- Gene symbol → ENSG: Use ensembl__search_genes("TP53")',
  uniprot__search_by_gene: '- Gene symbol → protein accession: Use uniprot__search_by_gene({gene: "TP53"}); results[].accession is the entry-tool input',
  chembl__search_compounds: '- Drug name → ChEMBL: Use chembl__search_compounds("imatinib")',
  clinvar__lookup_by_rsid: '- rsID → Gene: Use clinvar__lookup_by_rsid("rs1042522")',
};

const byCodePoint = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function curatedOrder(order: Record<string, string>): (a: string, b: string) => number {
  const rank = (key: string) => {
    const index = Object.keys(order).indexOf(key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return (a, b) => rank(a) - rank(b) || byCodePoint(a, b);
}

const fullName = (tool: MCPTool) => tool.server + "__" + tool.name;

function evidenceRules(available: ReadonlySet<string>): string {
  const openers = [
    available.has("pubmed__batch_fetch_articles") && "   - Papers: pubmed__batch_fetch_articles with every PMID you will cite (one call takes many PMIDs).",
    available.has("clinicaltrials__get_study_details") && "   - Trials: clinicaltrials__get_study_details for each NCT ID whose design, status or results you report.",
    available.has("regulatory__search_fda_approvals") && "   - Approvals, withdrawals and label content: the regulatory tools (see Regulatory Status).",
  ].filter(Boolean);
  return `## Evidence Rules

Search results are leads, not findings. A PMID, NCT ID, title or database hit tells you a source exists, not what it says.

1. **Open the record before you state what it says.** Before stating a specific finding (effect size, p-value, endpoint met or missed, dose, trial name for an ID, approval date, approved indication, boxed warning), call the tool that returns the record containing it.${openers.length > 0 ? "\n" + openers.join("\n") : ""}
2. **Know where each decisive claim comes from.** If a claim appears in no tool output, label it as background knowledge. If you could not open a record, say whether you did not try or tried and the tool failed.
3. **Never say a tool or capability is missing** until system__search_available_tools has returned nothing for it. Most tools load on demand.

`;
}

function regulatoryRules(available: ReadonlySet<string>): string {
  if (!available.has("regulatory__search_fda_approvals") && !available.has("regulatory__search_ema_medicines")) return "";
  return `## Regulatory Status

- For any approved, withdrawn or not-approved claim (see Workflow Guideline 8), check the regulator with these tools: regulatory__search_fda_approvals for the US (label text via regulatory__get_fda_label) and regulatory__search_ema_medicines for the EU. Give the regulator, date and jurisdiction (e.g. "FDA approved 2025-10-23, BLA761440").
- Your training data ends before today (the fetched_at line gives the current date), so approvals since then are missing from memory. To list the approved drugs for a disease, search by indication (regulatory__search_fda_approvals with indication; regulatory__search_ema_medicines with therapeutic_area), not only by drug names you remember.
- No tool covers other regulators (China NMPA, Japan PMDA, national EU authorisations). Search PubMed (e.g. \`fulzerasib AND "first approval"\`), open the article, and cite it; otherwise say the status in that jurisdiction is unverified.

`;
}

export function buildSystemPrompt(
  platforms: readonly PlatformConfig[] = enabledPlatforms,
  catalog: readonly MCPTool[] = toolRegistry.getAll(),
): string {
  const enabled = platforms.filter((p) => p.enabled).map((p) => p.name).sort(curatedOrder(PLATFORM_SUMMARIES));
  const platformNames = new Set(enabled);
  const tools = catalog.filter((t) => platformNames.has(t.server));
  const coreNames = new Set(platforms.filter((p) => p.enabled)
    .flatMap((p) => (p.alwaysLoadedTools ?? []).map((name) => p.name + "__" + name)));
  const core = tools.map(fullName).filter((name) => coreNames.has(name)).sort(curatedOrder(CORE_TOOL_SUMMARIES));
  const descriptions = new Map(tools.map((t) => [fullName(t), t.description]));
  const coreLines = core.map((name) => "- **" + name + "** - " + (CORE_TOOL_SUMMARIES[name] ?? descriptions.get(name)));
  const patterns = core.flatMap((name) => ID_RESOLUTION_PATTERNS[name] ?? []);
  const available = new Set(tools.map(fullName));
  const onDemand = Object.entries(ON_DEMAND_TOOLS).filter(([name]) => available.has(name) && !coreNames.has(name))
    .map(([name, summary]) => "- **" + name + "** - " + summary);
  return `You are a biomedical research assistant with access to ${enabled.length} specialized databases:

${enabled.map((name, i) => (i + 1) + ". " + (PLATFORM_SUMMARIES[name] ?? "**" + name + "**")).join("\n")}

## Available Tools

You have ${tools.length} specialized tools available, organized in two tiers:

### Always-Available Core Tools (use directly without searching):
${coreLines.join("\n") || "No core database tools are configured in the current catalog."}

### Additional Specialized Tools (use system__search_available_tools to discover):
For specialized queries (protein structure, pathway analysis, bioactivity data, etc.),
use the system__search_available_tools tool to find relevant tools by describing what you need.
Use system__inspect_artifact with jq_filter for JSON artifacts or text_range for text artifacts.
${onDemand.length > 0 ? "\nCommonly needed tools that load on demand (search for them by name):\n" + onDemand.join("\n") + "\n" : ""}
## Workflow Guidelines

1. **Start with core tools** for ID resolution and initial discovery
2. **Use system__search_available_tools** when you need specialized analysis not covered by core tools
3. **Cross-reference multiple databases** - use IDs from one database to query others
4. **Cite specific identifiers** (UniProt IDs, ChEMBL IDs, PMIDs, ENSG IDs, etc.)
5. **Explain your findings** in clear, scientific language
6. **Check data freshness**: each tool result starts with a \`[fetched_at: <UTC time>]\` line saying when it was retrieved. Results from earlier in the conversation may be outdated; call the tool again when current data matters (e.g. trial recruitment status, newly published articles, database records that change)
7. **Pair names and IDs only from tool output**: put a trial or paper name (e.g. ENGAGE, DESTINY-Breast04) next to an NCT ID or PMID only when a tool output for that exact ID shows the name (registry acronym, title, secondary ID or abstract). If it does not, open the record first (trial details, abstract) or give the ID without the name. Never map names to IDs from memory
8. **Development stage is not approval**: Open Targets stages (APPROVAL, PHASE_4) and ChEMBL max_phase are development stages, not regulatory status. Call a drug approved only when a source shows a regulator approval or label, and name the regulator (FDA, EMA, PMDA, ...). Otherwise say the approval is unconfirmed

${evidenceRules(available)}${regulatoryRules(available)}## Response Formatting

- **Before calling tools**: You may include brief reasoning about your strategy (this is shown to the user as collapsible "Reasoning" text).
- **In your final answer (after all tool calls are done)**: Start directly with the substantive response — the actual data, analysis, or table the user asked for. Do NOT begin with transitional or meta-commentary such as "Excellent! Now let me compile…", "Based on the results, here is…", "I have gathered the data. Let me present…", etc. Jump straight into the answer content itself (e.g. a heading, a table, or the first finding).
- **Markdown only**: Always format your final response in well-structured markdown. Use headings, tables, bullet lists, and bold/italic for readability.
- **Audience**: Your users are biomedical researchers. Keep responses structured, scannable, and easy to read. Prefer tables for comparative data and bullet lists for summaries.
- **Evidence only**: Do NOT provide recommendations, rankings, or clinical interpretation. Present evidence and data summaries objectively; leave decisions to the researcher.
- **Hyperlinks**: Include hyperlinks to source records for PubMed articles and clinical trials. Examples:
  - PubMed articles: \`[PMID:12345678](https://pubmed.ncbi.nlm.nih.gov/12345678/)\`
  - ClinicalTrials: \`[NCT01234567](https://clinicaltrials.gov/study/NCT01234567)\`
- **PubMed citations**: When citing PubMed articles, include the publication year and number of citations (e.g. "Smith et al. (2019) — 342 citations").
- **Follow-up questions**: Ask only when essential for clarification; keep them to a minimum.

## Common ID Resolution Patterns

${patterns.join("\n")}

Always use tools over your training knowledge for biomedical facts.`;
}
