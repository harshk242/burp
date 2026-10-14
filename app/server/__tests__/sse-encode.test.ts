import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { encodeSSE } from "../routes/sse-encode";
import type { StreamEvent } from "../orchestration/types";

async function roundTrip(events: { type: StreamEvent["type"]; data: unknown }[]) {
  const app = new Hono();
  app.get("/", (c) =>
    streamSSE(c, async (stream) => {
      for (const e of events) await stream.writeSSE(encodeSSE(e.type, e.data));
    })
  );
  const body = await (await app.request("/")).text();

  const decoded: { type: string; data: unknown }[] = [];
  for (const frame of body.split("\n\n")) {
    const lines = frame.split("\n");
    const type = lines.find((l) => l.startsWith("event: "))?.slice(7);
    const data = lines.filter((l) => l.startsWith("data:")).map((l) => (l.startsWith("data: ") ? l.slice(6) : l.slice(5)));
    if (type && data.length > 0) decoded.push({ type, data: JSON.parse(data.join("\n")) });
  }
  return decoded;
}

describe("encodeSSE", () => {
  it("round-trips text chunks that look like JSON or are whitespace-only", async () => {
    const chunks = ["42", "true", "null", "-1.5e3", '"quoted"', '{"content":"x"}', "[1]", " ", "  ", "\n", "\n\n", "\t", "a\r\nb", "x\ry", ""];
    const decoded = await roundTrip(chunks.map((data) => ({ type: "text", data })));

    expect(decoded).toEqual(chunks.map((data) => ({ type: "text", data })));
  });

  it("keeps each payload on one data line", () => {
    expect(encodeSSE("text", "line 1\nline 2")).toEqual({ event: "text", data: '"line 1\\nline 2"' });
  });

  it("round-trips object payloads of the other events", async () => {
    const events: { type: StreamEvent["type"]; data: unknown }[] = [
      { type: "start", data: { sessionId: "s1" } },
      { type: "reasoning", data: { text: "42", newBlock: true } },
      { type: "text_block_end", data: { isReasoning: true } },
      { type: "tool_start", data: { id: "c1", tool: "a__b", server: "a", toolName: "b", input: { n: 1 } } },
      { type: "tool_end", data: { id: "c1", tool: "a__b", output: "multi\nline\r\n" } },
      { type: "done", data: { messageId: "m1" } },
      { type: "usage", data: { inputTokens: 1, outputTokens: 2 } },
      { type: "error", data: { error: "boom" } },
    ];

    expect(await roundTrip(events)).toEqual(events);
  });
});
