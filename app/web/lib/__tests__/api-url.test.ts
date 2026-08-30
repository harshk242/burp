import { describe, expect, it } from "bun:test";
import { buildApiUrl } from "../api-url";

describe("buildApiUrl", () => {
  it("uses a relative API URL when no NEXT_PUBLIC_API_URL is configured", () => {
    expect(buildApiUrl("/sessions")).toBe("/api/sessions");
  });
});
