const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SESSION_ID_QUERY_KEY = "sessionId";

function isUuid(value: string | null): value is string {
  return Boolean(value && UUID_REGEX.test(value));
}

export function extractSessionIdFromLocation(location: Location): string | null {
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get(SESSION_ID_QUERY_KEY);
  if (isUuid(fromQuery)) {
    return fromQuery;
  }

  // Legacy URL support: /chat/<uuid>/
  const match = url.pathname.match(/\/chat\/([0-9a-f-]{36})\/?$/i);
  const fromPath = match?.[1] ?? null;
  return isUuid(fromPath) ? fromPath : null;
}

export function buildChatUrl(sessionId?: string | null): string {
  if (!sessionId) {
    return "/chat/";
  }

  return `/chat/?${SESSION_ID_QUERY_KEY}=${encodeURIComponent(sessionId)}`;
}
