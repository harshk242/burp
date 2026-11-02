import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { createTestDb } from "../__test-utils__/db";
import { createQueries } from "../db/queries";
import { validateAuthConfig } from "../auth-config";
import type { AppEnv } from "../types";

const t = createTestDb();
const q = createQueries(t.db);
mock.module("../db", () => ({ db: t.db, sqlite: t.sqlite, ...q }));
const { clerkAuth } = await import("../middleware/clerk");
const app = new Hono<AppEnv>();
app.use("*", clerkAuth);
app.get("/", (c) => c.json({ role: c.get("role"), email: c.get("email") }));
const saved = { ...process.env };

beforeEach(() => {
  process.env.CLERK_SECRET_KEY = "";
  process.env.DEV_AGENT_TOKEN = "";
  process.env.NODE_ENV = "test";
  delete process.env.AUTH_MODE;
});
afterEach(() => {
  for (const key of ["CLERK_SECRET_KEY", "DEV_AGENT_TOKEN", "NODE_ENV", "AUTH_MODE"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
afterAll(() => t.sqlite.close());

describe("explicit development authentication", () => {
  it("rejects missing authentication configuration without creating an admin", async () => {
    const response = await app.request("/");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "auth_not_configured" });
    expect(q.userQueries.findByClerkId("dev-clerk-id")).toBeNull();
  });

  it("uses the development identity only with explicit opt-in outside production", async () => {
    process.env.AUTH_MODE = "development";
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "admin" });
  });

  for (const mode of ["clerk", "development"]) {
    it(`refuses production without a secret even with AUTH_MODE=${mode}`, async () => {
      process.env.AUTH_MODE = mode;
      process.env.NODE_ENV = "production";
      expect(() => validateAuthConfig()).toThrow("CLERK_SECRET_KEY");
      expect((await app.request("/")).status).toBe(503);
    });
  }

  it("accepts configured production authentication", () => {
    expect(() => validateAuthConfig({ NODE_ENV: "production", CLERK_SECRET_KEY: "sk_live_key" })).not.toThrow();
  });
});
