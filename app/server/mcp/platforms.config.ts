/**
 * MCP Platforms Configuration — Single Source of Truth
 *
 * To disable a platform: set `enabled: false`
 * To add a new platform: add an entry to PLATFORMS
 *
 * Both the MCP manager (server spawning) and the tool registry
 * (always-loaded tools) read from this file.
 */

export interface PlatformConfig {
  /** Display / registry name (e.g. "uniprot") */
  name: string;
  /** Directory name under mcp-servers/ (e.g. "clinical-trials") */
  dir: string;
  /** Whether this platform is active */
  enabled: boolean;
  /** Optional env vars forwarded to the server process */
  env?: Record<string, string | undefined>;
  /**
   * Tools from this platform that should always be loaded (non-deferred).
   * Use the bare tool name (without the server prefix).
   */
  alwaysLoadedTools?: string[];
}

export const PLATFORMS: PlatformConfig[] = [
  {
    name: "ensembl",
    dir: "ensembl",
    enabled: true,
    alwaysLoadedTools: [
      "search_genes",   // Gene symbol -> ENSG (foundation ID)
      "get_xrefs",      // Ensembl -> UniProt cross-refs
    ],
  },
  {
    name: "open-targets",
    dir: "open-targets",
    enabled: true,
    alwaysLoadedTools: [
      "search_entities", // Gene/disease -> ENSG/EFO (most connected hub)
    ],
  },
  // {
  //   name: "uniprot",
  //   dir: "uniprot",
  //   enabled: true,
  //   alwaysLoadedTools: [
  //     "search_by_gene",        // Gene symbol -> UniProt accession
  //     "get_external_references", // UniProt -> Ensembl cross-refs
  //   ],
  // },
  {
    name: "chembl",
    dir: "chembl",
    enabled: true,
    alwaysLoadedTools: [
      "search_compounds", // Drug name -> ChEMBL ID
    ],
  },
  {
    name: "pubchem",
    dir: "pubchem",
    enabled: true,
    alwaysLoadedTools: [
      "search_by_smiles", // SMILES -> PubChem CID
    ],
  },
  {
    name: "clinvar",
    dir: "clinvar",
    enabled: true,
    env: { NCBI_API_KEY: process.env.NCBI_API_KEY },
    alwaysLoadedTools: [
      "lookup_by_rsid", // rsID -> clinical context + gene
    ],
  },
  {
    name: "reactome",
    dir: "reactome",
    enabled: true,
  },
  {
    name: "clinicaltrials",
    dir: "clinical-trials",
    enabled: true,
    alwaysLoadedTools: [
      "search_by_intervention", // Drug -> NCT IDs
      "search_by_condition",    // Condition -> NCT IDs
    ],
  },
  {
    name: "pubmed",
    dir: "pubmed",
    enabled: true,
    env: { NCBI_API_KEY: process.env.NCBI_API_KEY },
    alwaysLoadedTools: [
      "search_pubmed", // Quick PMID discovery
    ],
  },
  {
    name: "clinpgx",
    dir: "clinpgx",
    enabled: true,
  },
];

// ── Derived helpers (consumed by manager.ts and registry.ts) ──

/** Only the platforms that are enabled */
export const enabledPlatforms = PLATFORMS.filter((p) => p.enabled);

/**
 * Set of "server__tool" names that should always be loaded (non-deferred).
 * Automatically excludes tools from disabled platforms.
 */
export const ALWAYS_LOADED_TOOLS: Set<string> = new Set(
  enabledPlatforms.flatMap((p) =>
    (p.alwaysLoadedTools ?? []).map((tool) => `${p.name}__${tool}`)
  )
);
