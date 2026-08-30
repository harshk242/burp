export function buildApiUrl(path: string, apiBase = ""): string {
  return `${apiBase}/api${path}`;
}
