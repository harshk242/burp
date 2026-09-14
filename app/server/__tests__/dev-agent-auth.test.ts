import { describe, expect, test } from "bun:test";
import { isValidDevAgentToken } from "../middleware/devAgentAuth";

const token = "a".repeat(64);

describe("development agent authentication", () => {
  test("accepts the configured token outside production", () => {
    expect(isValidDevAgentToken(token, token, "development")).toBe(true);
  });

  test("rejects incorrect and weak tokens", () => {
    expect(isValidDevAgentToken("b".repeat(64), token, "development")).toBe(false);
    expect(isValidDevAgentToken("short", "short", "development")).toBe(false);
  });

  test("is always disabled in production", () => {
    expect(isValidDevAgentToken(token, token, "production")).toBe(false);
  });
});
