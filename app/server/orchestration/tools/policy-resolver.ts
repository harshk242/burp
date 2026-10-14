import { appConfig } from "../../config";
import { validateJqFilter } from "./jq-engine";

/**
 * Resolve the effective filter chain for a given tool.
 *
 * @param toolName - Fully qualified tool name (e.g. "uniprot__search_by_gene")
 * @returns Ordered array of jq filter expressions to apply sequentially
 */
export function resolveFilterChain(toolName: string): string[] {
  const { policies } = appConfig.artifact;
  const filters: string[] = [];

  if (policies.global?.noise_filters) {
    filters.push(...policies.global.noise_filters);
  }

  const platform = extractPlatformName(toolName);
  if (platform && policies.platforms?.[platform]?.noise_filters) {
    filters.push(...policies.platforms[platform].noise_filters);
  }

  const toolPolicy = policies.tools?.[toolName];
  if (toolPolicy?.noise_filters) {
    filters.push(...toolPolicy.noise_filters);
  }

  if (toolPolicy?.semantic_profile) {
    const profileFilters = policies.profiles?.[toolPolicy.semantic_profile];
    if (profileFilters) {
      filters.push(...profileFilters);
    }
  }

  return filters;
}

export async function validatePolicies(): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const { policies } = appConfig.artifact;
  const errors: string[] = [];

  const allFilters: { source: string; filter: string }[] = [];

  for (const f of policies.global?.noise_filters ?? []) {
    allFilters.push({ source: "global", filter: f });
  }

  for (const [platform, policy] of Object.entries(policies.platforms ?? {})) {
    for (const f of policy.noise_filters ?? []) {
      allFilters.push({ source: `platform:${platform}`, filter: f });
    }
  }

  for (const [tool, policy] of Object.entries(policies.tools ?? {})) {
    for (const f of policy.noise_filters ?? []) {
      allFilters.push({ source: `tool:${tool}`, filter: f });
    }

    if (policy.semantic_profile) {
      if (!policies.profiles?.[policy.semantic_profile]) {
        errors.push(
          `tool:${tool} references profile "${policy.semantic_profile}" which does not exist in policies.profiles`,
        );
      }
    }
  }

  for (const [name, profileFilters] of Object.entries(policies.profiles ?? {})) {
    for (const f of profileFilters) {
      allFilters.push({ source: `profile:${name}`, filter: f });
    }
  }

  for (const { source, filter } of allFilters) {
    const result = await validateJqFilter(filter);
    if (!result.valid) {
      errors.push(
        `Invalid jq filter in ${source}: "${filter}" — ${result.error}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

function extractPlatformName(toolName: string): string | null {
  const idx = toolName.indexOf("__");
  return idx > 0 ? toolName.slice(0, idx) : null;
}
