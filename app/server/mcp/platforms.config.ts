import { appConfig } from "../config";

export interface PlatformConfig {
  name: string;
  enabled: boolean;
  env?: Record<string, string | undefined>;
  alwaysLoadedTools?: string[];
}

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

export const ALWAYS_LOADED_TOOLS: Set<string> = new Set(
  enabledPlatforms.flatMap((p) =>
    (p.alwaysLoadedTools ?? []).map((tool) => `${p.name}__${tool}`)
  )
);
