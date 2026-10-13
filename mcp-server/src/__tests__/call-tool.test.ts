import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { createCallToolHandler } from '../call-tool.js';
import { UpstreamError } from '../shared/exceptions.js';
import { REASON_TO_KIND, formatUpstreamMessage, type UpstreamReason } from '../shared/http-retry-classify.js';
import { abortableSleep, type RetryPolicy } from '../shared/http-retry.js';
import { getToolCallContext, type RetryMeta } from '../shared/tool-call-context.js';
import { stubClient, type Step } from '../shared/__tests__/retry-test-utils.js';
import type { ToolHandler } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ERROR_KEYS = [
  'error',
  'reason',
  'platform',
  'status',
  'attempts',
  'elapsed_ms',
  'retry_after_ms',
  'retryable_later',
  'message',
];

function call(
  handler: ToolHandler,
  options: { meta?: Record<string, unknown>; signal?: AbortSignal } = {},
): Promise<CallToolResult> {
  const handle = createCallToolHandler(new Map([['test__tool', handler]]));
  return handle(
    { method: 'tools/call', params: { name: 'test__tool', arguments: {}, _meta: options.meta } },
    { signal: options.signal ?? new AbortController().signal },
  );
}

function text(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type !== 'text') throw new Error('expected text content');
  return item.text;
}

function retryMeta(result: CallToolResult): RetryMeta | undefined {
  return result._meta?.retry as RetryMeta | undefined;
}

/** A test tool that GETs `paths` in order from a stubbed upstream. */
function upstreamTool(steps: Step[], policy: Partial<RetryPolicy> = {}, paths = ['/lookup/id/X']) {
  const { client, calls } = stubClient(steps, policy, { deps: { sleep: abortableSleep } });
  const tool: ToolHandler = async () => {
    const results = [];
    for (const path of paths) results.push((await client.get(path)).data);
    return results;
  };
  return { tool, calls };
}

function upstreamError(reason: UpstreamReason): UpstreamError {
  const details = { reason, platform: 'ensembl', status: null, attempts: 2, elapsedMs: 1234 };
  return new UpstreamError(formatUpstreamMessage(details), {
    ...details,
    kind: REASON_TO_KIND[reason].kind,
    retryAfterMs: reason === 'rate_limited' ? 3000 : null,
    url: '/lookup/id/X',
  });
}

afterEach(() => {
  vi.useRealTimers();
});

// ── Structured upstream errors ────────────────────────────────────────────────

describe('UpstreamError formatting', () => {
  it.each(Object.entries(REASON_TO_KIND) as [UpstreamReason, (typeof REASON_TO_KIND)[UpstreamReason]][])(
    '%s → structured JSON',
    async (reason, info) => {
      const result = await call(async () => {
        throw upstreamError(reason);
      });
      expect(result.isError).toBe(true);
      const payload = JSON.parse(text(result));
      expect(Object.keys(payload)).toEqual(ERROR_KEYS);
      expect(payload.error).toBe(info.kind);
      expect(payload.reason).toBe(reason);
      expect(payload.retryable_later).toBe(info.retryableLater);
      expect(payload).toMatchObject({
        platform: 'ensembl',
        status: null,
        attempts: 2,
        elapsed_ms: 1234,
        retry_after_ms: reason === 'rate_limited' ? 3000 : null,
      });
      if (info.hint) expect(payload.message).toContain(info.hint);
    },
  );

  it('formats a real retried upstream failure', async () => {
    const { tool, calls } = upstreamTool([500], { backoffMs: [0] });
    const result = await call(tool);
    expect(calls).toHaveLength(3);
    const payload = JSON.parse(text(result));
    expect(payload).toMatchObject({
      error: 'upstream_unavailable',
      reason: 'http_5xx',
      platform: 'ensembl',
      status: 500,
      attempts: 3,
      retry_after_ms: null,
      retryable_later: true,
    });
    expect(payload.message).toMatch(/^Ensembl returned HTTP 500 on 3 attempts/);
  });

  it('keeps the plain "Error: …" text for other errors', async () => {
    const result = await call(async () => {
      throw new Error('boom');
    });
    expect(result).toEqual({ content: [{ type: 'text', text: 'Error: boom' }], isError: true });
  });
});

// ── Deadline ──────────────────────────────────────────────────────────────────

describe('tool-call deadline', () => {
  it('is taken from _meta.deadline_ms minus the 5s margin', async () => {
    vi.useFakeTimers();
    let remaining: number | undefined;
    await call(async () => {
      remaining = getToolCallContext()?.remainingMs();
      return {};
    }, { meta: { deadline_ms: 30_000 } });
    expect(remaining).toBe(25_000);
  });

  it('falls back to 55s when _meta.deadline_ms is missing', async () => {
    vi.useFakeTimers();
    let remaining: number | undefined;
    await call(async () => {
      remaining = getToolCallContext()?.remainingMs();
      return {};
    });
    expect(remaining).toBe(55_000);
  });

  it('fires during a backoff sleep → timeout at the deadline, not after the sleep', async () => {
    vi.useFakeTimers();
    const { tool, calls } = upstreamTool([500, 200], {
      backoffMs: [60_000],
      totalBudgetMs: 120_000,
      perAttemptTimeoutMs: 5_000,
    });
    const start = Date.now();
    let settledAt: number | undefined;
    const pending = call(tool, { meta: { deadline_ms: 10_000 } }).then((r) => {
      settledAt = Date.now();
      return r;
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(settledAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(settledAt! - start).toBeLessThanOrEqual(5_005);
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(text(result));
    expect(payload).toMatchObject({ error: 'timeout', reason: 'budget_timeout', status: 500, attempts: 1 });
    expect(retryMeta(result)?.outcome).toBe('failed');
  });

  it('fires during a 55s default deadline when the request hangs', async () => {
    vi.useFakeTimers();
    const { tool } = upstreamTool(['hang'], { totalBudgetMs: 120_000, perAttemptTimeoutMs: 120_000 });
    let settled = false;
    const pending = call(tool).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(54_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse(text(await pending)).error).toBe('timeout');
  });
});

// ── Cancellation ──────────────────────────────────────────────────────────────

describe('extra.signal cancellation', () => {
  it('abort during backoff → cancelled, no further requests', async () => {
    vi.useFakeTimers();
    const { tool, calls } = upstreamTool([500, 200], { backoffMs: [10_000] });
    const controller = new AbortController();
    const pending = call(tool, { signal: controller.signal });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(1);
    controller.abort();
    const result = await pending;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(calls).toHaveLength(1);
    const payload = JSON.parse(text(result));
    expect(payload).toMatchObject({ error: 'cancelled', reason: 'cancelled', retryable_later: false });
    expect(retryMeta(result)?.outcome).toBe('cancelled');
  });

  it('abort before a later request → that request is never sent', async () => {
    const controller = new AbortController();
    const { client, calls } = stubClient([200], {}, { deps: { sleep: abortableSleep } });
    const tool: ToolHandler = async () => {
      await client.get('/a');
      controller.abort();
      await client.get('/b');
      return {};
    };
    const result = await call(tool, { signal: controller.signal });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(text(result)).error).toBe('cancelled');
    expect(retryMeta(result)).toMatchObject({ outcome: 'cancelled', request_count: 2 });
  });
});

// ── _meta.retry ───────────────────────────────────────────────────────────────

describe('_meta.retry', () => {
  it('is attached to a success result', async () => {
    const { tool } = upstreamTool([200]);
    const result = await call(tool);
    expect(result.isError).toBeUndefined();
    expect(retryMeta(result)).toMatchObject({
      platforms: ['ensembl'],
      request_count: 1,
      attempts: 1,
      outcome: 'success',
      requests_truncated: false,
    });
    expect(retryMeta(result)?.requests[0]).toMatchObject({ method: 'GET', path: '/lookup/id/X', statuses: [200] });
  });

  it('reports a recovered call', async () => {
    const { tool } = upstreamTool([503, 200]);
    const result = await call(tool);
    expect(retryMeta(result)).toMatchObject({ attempts: 2, retried_requests: 1, outcome: 'recovered' });
  });

  it('reports partial when the tool succeeds despite a failed request', async () => {
    const { client } = stubClient([404, 200], {}, { deps: { sleep: abortableSleep } });
    const tool: ToolHandler = async () => {
      await client.get('/missing').catch(() => null);
      return (await client.get('/found')).data;
    };
    const result = await call(tool);
    expect(retryMeta(result)).toMatchObject({ request_count: 2, failed_requests: 1, outcome: 'partial' });
  });

  it('is attached to an error result', async () => {
    const { tool } = upstreamTool([404]);
    const result = await call(tool);
    expect(result.isError).toBe(true);
    expect(retryMeta(result)).toMatchObject({ request_count: 1, failed_requests: 1, outcome: 'failed' });
  });

  it('is absent when no upstream request was made', async () => {
    const ok = await call(async () => ({ ok: true }));
    const failed = await call(async () => {
      throw new Error('bad input');
    });
    expect(ok._meta).toBeUndefined();
    expect(failed._meta).toBeUndefined();
  });

  it('is absent for an unknown tool', async () => {
    const handle = createCallToolHandler(new Map());
    const result = await handle(
      { method: 'tools/call', params: { name: 'nope' } },
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({ content: [{ type: 'text', text: 'Unknown tool: nope' }], isError: true });
  });
});
