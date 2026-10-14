import { enabledPlatforms } from "../mcp/platforms.config";
import type { LLMProviderName } from "./config";

const HYPHENATED_PLATFORMS = new Set(
  enabledPlatforms
    .filter((p) => p.name.includes("-"))
    .map((p) => p.name)
);

export function sanitizeToolName(name: string, provider: LLMProviderName): string {
  if (provider !== "google") return name;
  return name.replace(/-/g, "_");
}

export function desanitizeToolName(sanitized: string, provider: LLMProviderName): string {
  if (provider !== "google") return sanitized;

  const sep = sanitized.indexOf("__");
  if (sep === -1) return sanitized;

  const prefix = sanitized.substring(0, sep);
  const rest = sanitized.substring(sep);

  for (const platform of HYPHENATED_PLATFORMS) {
    const sanitizedPlatform = platform.replace(/-/g, "_");
    if (prefix === sanitizedPlatform) {
      return platform + rest;
    }
  }

  return sanitized;
}
