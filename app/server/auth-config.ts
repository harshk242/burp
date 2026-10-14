type AuthEnvironment = Partial<Pick<NodeJS.ProcessEnv, "AUTH_MODE" | "NODE_ENV" | "CLERK_SECRET_KEY">>;

export const AUTH_CONFIGURATION_MESSAGE =
  "Server authentication is not configured. Set CLERK_SECRET_KEY, or explicitly set AUTH_MODE=development outside production for local development.";

export function resolveAuthConfig(env: AuthEnvironment = process.env) {
  return {
    secretKey: env.CLERK_SECRET_KEY?.trim() || null,
    development: env.AUTH_MODE === "development" && env.NODE_ENV !== "production",
    production: env.NODE_ENV === "production",
  };
}

export function validateAuthConfig(env: AuthEnvironment = process.env): void {
  const config = resolveAuthConfig(env);
  if (config.production && !config.secretKey) {
    throw new Error(AUTH_CONFIGURATION_MESSAGE);
  }
}
