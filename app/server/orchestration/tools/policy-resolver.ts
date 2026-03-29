/**
 * Policy Resolver & Validator
 *
 * Resolves the effective jq filter chain for a given tool call
 * by composing the 3-layer policy hierarchy:
 *   global -> platform -> tool (+ optional semantic profile)
 *
 * All layers compose (concatenate), they don't override each other.
 * A tool gets all global filters, plus its platform's filters,
 * plus any tool-specific filters and semantic profile.
 */

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

  // Layer 1: Global noise filters
  if (policies.global?.noise_filters) {
    filters.push(...policies.global.noise_filters);
  }

  // Layer 2: Platform-level noise filters
  const platform = extractPlatformName(toolName);
  if (platform && policies.platforms?.[platform]?.noise_filters) {
    filters.push(...policies.platforms[platform].noise_filters);
  }

  // Layer 3: Tool-specific noise filters
  const toolPolicy = policies.tools?.[toolName];
  if (toolPolicy?.noise_filters) {
    filters.push(...toolPolicy.noise_filters);
  }

  // Layer 3b: Semantic profile (if referenced by tool)
  if (toolPolicy?.semantic_profile) {
    const profileFilters = policies.profiles?.[toolPolicy.semantic_profile];
    if (profileFilters) {
      filters.push(...profileFilters);
    }
  }

  return filters;
}

/**
 * Validate all jq filter expressions in the policy config.
 * Intended to run at startup — logs warnings but doesn't crash.
 *
 * Checks:
 * - jq filter syntax validity (dry-run against null input)
 * - semantic_profile references resolve to existing profiles
 */
export async function validatePolicies(): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const { policies } = appConfig.artifact;
  const errors: string[] = [];

  // Collect all filter strings from all layers
  const allFilters: { source: string; filter: string }[] = [];

  // Global
  for (const f of policies.global?.noise_filters ?? []) {
    allFilters.push({ source: "global", filter: f });
  }

  // Platforms
  for (const [platform, policy] of Object.entries(policies.platforms ?? {})) {
    for (const f of policy.noise_filters ?? []) {
      allFilters.push({ source: `platform:${platform}`, filter: f });
    }
  }

  // Tools
  for (const [tool, policy] of Object.entries(policies.tools ?? {})) {
    for (const f of policy.noise_filters ?? []) {
      allFilters.push({ source: `tool:${tool}`, filter: f });
    }

    // Check semantic_profile reference
    if (policy.semantic_profile) {
      if (!policies.profiles?.[policy.semantic_profile]) {
        errors.push(
          `tool:${tool} references profile "${policy.semantic_profile}" which does not exist in policies.profiles`,
        );
      }
    }
  }

  // Profiles
  for (const [name, profileFilters] of Object.entries(policies.profiles ?? {})) {
    for (const f of profileFilters) {
      allFilters.push({ source: `profile:${name}`, filter: f });
    }
  }

  // Validate each filter's jq syntax
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

/**
 * Extract platform name from a fully-qualified tool name.
 * e.g. "uniprot__search_by_gene" → "uniprot"
 */
function extractPlatformName(toolName: string): string | null {
  const idx = toolName.indexOf("__");
  return idx > 0 ? toolName.slice(0, idx) : null;
}
