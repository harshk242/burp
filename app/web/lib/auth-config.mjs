/** @param {Record<string, string | undefined>} env */
export function resolveWebAuthConfig(env, production = env.NODE_ENV === "production") {
  const publishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || "";
  const development = !production && env.AUTH_MODE === "development" && !publishableKey;
  if (!publishableKey && !development) {
    throw new Error("Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, or explicitly set AUTH_MODE=development outside production.");
  }
  if (publishableKey) {
    const match = /^pk_(?:test|live)_([A-Za-z0-9+/]+={0,2})$/.exec(publishableKey);
    const frontend = match ? Buffer.from(match[1], "base64").toString("utf8") : "";
    if (!/^[a-zA-Z0-9.-]+\$$/.test(frontend)) {
      throw new Error("Invalid NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: expected a Clerk publishable key.");
    }
  }
  return { publishableKey, development };
}
