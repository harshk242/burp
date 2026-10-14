import { expect, it, spyOn } from "bun:test";
import { logger } from "../logger";
import { trackActivityBestEffort } from "../middleware/clerk";

it("reports activity write failure and returns normally for authenticated callers", () => {
  const warn = spyOn(logger, "warn").mockImplementation(() => {});
  try {
    const failure = new Error("database locked");
    expect(() => trackActivityBestEffort("user", () => { throw failure; })).not.toThrow();
    expect(warn).toHaveBeenCalledWith("AUTH", "activity_write_failed", { ctx: { user_id: "user" }, error: failure });
    let written = "";
    trackActivityBestEffort("user", (id) => { written = id; });
    expect(written).toBe("user");
    expect(warn).toHaveBeenCalledTimes(1);
  } finally { warn.mockRestore(); }
});
