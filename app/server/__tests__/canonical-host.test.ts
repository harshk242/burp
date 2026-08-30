import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { redirectWwwToCanonical } from "../middleware/canonical-host";

function createTestApp() {
  const app = new Hono();
  app.use("*", redirectWwwToCanonical);
  app.all("*", (c) => c.text("handled"));
  return app;
}

describe("canonical host redirect", () => {
  it("redirects www page requests to the apex host", async () => {
    const response = await createTestApp().request(
      "https://www.tryburp.com/chat/?foo=bar",
      { redirect: "manual" }
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://tryburp.com/chat/?foo=bar");
  });

  it("does not redirect apex-host requests", async () => {
    const response = await createTestApp().request("https://tryburp.com/chat/");

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("preserves an API path and query string with a permanent redirect", async () => {
    const response = await createTestApp().request(
      "https://www.tryburp.com/api/sessions?limit=20&cursor=abc",
      { method: "POST", redirect: "manual" }
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://tryburp.com/api/sessions?limit=20&cursor=abc"
    );
  });
});
