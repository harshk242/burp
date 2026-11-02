import { afterAll, expect, it } from "bun:test";
import { getActiveSpanId, getActiveTraceId, startActiveObservation } from "@langfuse/tracing";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { initTracing, resetTracingForTests } from "../langfuse";
import { TurnTrace } from "../turn-trace";

afterAll(() => resetTracingForTests());

it("the experiment task's active span is readable and the turn nests under it", async () => {
  const exporter = new InMemorySpanExporter();
  resetTracingForTests();
  initTracing({ spanProcessors: [new SimpleSpanProcessor(exporter)], registerGlobal: true });

  let seen: { traceId?: string; spanId?: string } = {};
  await startActiveObservation("experiment-item-run", async () => {
    await Bun.sleep(1);
    seen = { traceId: getActiveTraceId(), spanId: getActiveSpanId() };
    const turn = TurnTrace.start({
      turnId: "turn-1",
      sessionId: "s",
      userId: "u",
      userMessage: "hi",
      provider: "anthropic",
      model: "m",
      traceParent: { traceId: seen.traceId!, spanId: seen.spanId! },
    });
    turn.end({ status: "ok", output: "done" });
  });

  const spans = exporter.getFinishedSpans();
  const task = spans.find((s) => s.name === "experiment-item-run")!;
  const turn = spans.find((s) => s.name === "chat-turn")!;
  expect(seen.spanId).toBe(task.spanContext().spanId);
  expect(turn.spanContext().traceId).toBe(task.spanContext().traceId);
  expect(turn.parentSpanContext?.spanId).toBe(task.spanContext().spanId);
});
