import { streamText, type ModelMessage } from "ai";
import { getChatModel } from "../../server/llm";

export const REDACTED_TRIGGER = "ANTHROPIC_MAGIC_STRING_TRIGGER_REDACTED_THINKING_46C9A13E193C177646C7398A98432ECCCE4C1253";

const DATA = "EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rLVyIwxtE3rAFBa8cr3qpPkNRj2YfWXGmKDxH4mPnZ5sQ7vB5URj/pa2ZBaGgVQjN7LkQ==";

function sse(events: object[]): Response {
  const text = events.map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const CANNED = [
  { type: "message_start", message: { id: "msg_gate", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: DATA } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "OK" } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: "message_stop" },
];

export async function checkRedactedOffline(): Promise<{ pass: boolean; detail: string }> {
  const first = streamText({
    model: getChatModel({ fetch: (async () => sse(CANNED)) as unknown as typeof fetch }),
    messages: [{ role: "user", content: "hi" }],
    maxRetries: 0,
  });
  for await (const _ of first.stream);
  const response = (await first.finalStep).response.messages;
  const parsed: ModelMessage[] = JSON.parse(JSON.stringify(response));
  const parts = parsed.flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : [])) as any[];
  const reasoning = parts.find((p) => p.type === "reasoning");
  const kept = reasoning?.providerOptions?.anthropic?.redactedData === DATA;

  let body: any;
  const second = streamText({
    model: getChatModel({
      fetch: (async (_url: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "gate: captured" } }), { status: 400 });
      }) as unknown as typeof fetch,
    }),
    messages: [{ role: "user", content: "hi" }, ...parsed, { role: "user", content: "again" }],
    maxRetries: 0,
    onError: () => {},
  });
  for await (const _ of second.stream);
  const sent = (body?.messages ?? []).flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === "redacted_thinking");
  const replayed = sent.length === 1 && sent[0].data === DATA;
  return {
    pass: kept && replayed,
    detail: `parsed reasoning part redactedData intact: ${kept}; replay body redacted_thinking blocks ${sent.length}, data intact: ${replayed}`,
  };
}
