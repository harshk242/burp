import { timingSafeEqual } from "node:crypto";

const MIN_DEV_AGENT_TOKEN_LENGTH = 32;

/**
 * Authenticate a local coding agent without creating a Clerk browser session.
 * This mechanism is deliberately unavailable in production.
 */
export function isValidDevAgentToken(
  requestToken: string,
  configuredToken = process.env.DEV_AGENT_TOKEN,
  nodeEnv = process.env.NODE_ENV
): boolean {
  if (
    nodeEnv === "production" ||
    !configuredToken ||
    configuredToken.length < MIN_DEV_AGENT_TOKEN_LENGTH
  ) {
    return false;
  }

  const actual = Buffer.from(requestToken);
  const expected = Buffer.from(configuredToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
