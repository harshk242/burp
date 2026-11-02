import { describe, expect, it } from "bun:test";
import { resolveWebAuthConfig } from "../auth-config.mjs";
const key = "pk_live_Y2xlcmsudHJ5YnVycC5jb20k";

describe("web authentication configuration", () => {
  it("requires a key in production even with explicit development auth", () => {
    expect(() => resolveWebAuthConfig({ NODE_ENV: "production", AUTH_MODE: "development" })).toThrow(/NEXT_PUBLIC_CLERK/);
    expect(() => resolveWebAuthConfig({ AUTH_MODE: "development" }, true)).toThrow(/NEXT_PUBLIC_CLERK/);
  });
  it("requires explicit development mode when no key is configured", () => {
    expect(() => resolveWebAuthConfig({ NODE_ENV: "development" })).toThrow(/AUTH_MODE/);
    expect(resolveWebAuthConfig({ NODE_ENV: "development", AUTH_MODE: "development" })).toEqual({ publishableKey: "", development: true });
  });
  it("accepts the deployment key and disables provider-free mode when a key exists", () => {
    expect(resolveWebAuthConfig({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: key, AUTH_MODE: "development" })).toEqual({ publishableKey: key, development: false });
    expect(resolveWebAuthConfig({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: key, NODE_ENV: "production" }).development).toBe(false);
  });
  it.each(["invalid", "pk_live_invalid", "pk_test_", "   "])("rejects invalid key %s", (value) => {
    expect(() => resolveWebAuthConfig({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: value }, true)).toThrow();
  });
});
