/**
 * MCP Platforms Configuration — derived from app/config.yaml.
 *
 * To enable/disable a platform or change always-loaded tools,
 * edit app/config.yaml instead of this file.
 *
 * Secrets (NCBI_API_KEY) are injected here from process.env because
 * they must not appear in the YAML config file.
 */

import { appConfig } from "../config";

export interface PlatformConfig {
  name: string;
  enabled: boolean;
  env?: Record<string, string | undefined>;
  alwaysLoadedTools?: string[];
}

/** Platforms that require NCBI API key forwarded to the MCP process */
const NCBI_PLATFORMS = new Set(["clinvar", "pubmed"]);

export const PLATFORMS: PlatformConfig[] = Object.entries(appConfig.platforms).map(
  ([name, cfg]) => ({
    name,
    enabled: cfg.enabled,
    alwaysLoadedTools: cfg.always_loaded_tools,
    ...(NCBI_PLATFORMS.has(name) && { env: { NCBI_API_KEY: process.env.NCBI_API_KEY } }),
  })
);

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
