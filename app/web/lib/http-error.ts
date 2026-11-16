/** The `error` string of a JSON error response body, when it has one. */
export function errorField(body: unknown): string | undefined {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined;
}
