import { expect, it } from "bun:test";
import { RunLifecycle } from "../lib/lifecycle";

it.each(["sync", "async"])("continues cleanup and reports %s stage failures", async (mode) => {
  const events: string[] = [];
  const fail = (stage: string) => {
    events.push(stage);
    if (mode === "sync") throw new Error(stage);
    return Promise.reject(new Error(stage));
  };
  const lifecycle = new RunLifecycle({
    stopBackground: () => fail("background"),
    shutdownTracing: () => fail("tracing"),
    stopMcp: () => fail("mcp"),
    log: (line) => events.push(line),
  });
  const before = process.listenerCount("SIGINT");
  const removeHandlers = lifecycle.installSignalHandlers();
  try {
    await lifecycle.cleanup();
    await lifecycle.cleanup();
    expect(events).toEqual(["background", "background stop failed: background", "tracing", "tracing flush failed: tracing", "mcp", "MCP stop failed: mcp"]);
  } finally { removeHandlers(); }
  expect(process.listenerCount("SIGINT")).toBe(before);
});

it("bounds MCP shutdown", async () => {
  const logs: string[] = [];
  const lifecycle = new RunLifecycle({ shutdownTracing: async () => {}, stopMcp: () => new Promise(() => {}), mcpStopTimeoutMs: 1, log: (line) => logs.push(line) });
  await lifecycle.cleanup();
  expect(logs).toEqual(["MCP stop timed out after 1 ms"]);
});
