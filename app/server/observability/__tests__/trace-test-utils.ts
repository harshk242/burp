import type { Context } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { initTracing, resetTracingForTests } from "../langfuse";

export const LEVEL = "langfuse.observation.level";
export const TYPE = "langfuse.observation.type";
export const STATUS_MESSAGE = "langfuse.observation.status_message";

class OpenSpanTracker implements SpanProcessor {
  readonly open = new Map<string, string>();
  readonly endCounts = new Map<string, number>();
  onStart(span: Span, _ctx: Context): void {
    this.open.set(span.spanContext().spanId, span.name);
  }
  onEnd(span: ReadableSpan): void {
    const id = span.spanContext().spanId;
    this.open.delete(id);
    this.endCounts.set(id, (this.endCounts.get(id) ?? 0) + 1);
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export function installMemoryTracing() {
  const exporter = new InMemorySpanExporter();
  const tracker = new OpenSpanTracker();
  resetTracingForTests();
  initTracing({ spanProcessors: [new SimpleSpanProcessor(exporter), tracker] });
  return {
    spans: () => exporter.getFinishedSpans(),
    /** Names of spans started and not ended. */
    openSpans: () => [...tracker.open.values()],
    /** True when every finished span ended exactly once. */
    endedOnce: () => [...tracker.endCounts.values()].every((n) => n === 1),
    reset: () => {
      exporter.reset();
      tracker.open.clear();
      tracker.endCounts.clear();
    },
  };
}

export function byName(spans: ReadableSpan[], name: string): ReadableSpan[] {
  return spans.filter((s) => s.name === name);
}

export function one(spans: ReadableSpan[], name: string): ReadableSpan {
  const found = byName(spans, name);
  if (found.length !== 1) throw new Error(`expected one "${name}" span, found ${found.length}`);
  return found[0]!;
}

export function json(span: ReadableSpan, key: string): unknown {
  const value = span.attributes[key];
  return typeof value === "string" ? JSON.parse(value) : value;
}
