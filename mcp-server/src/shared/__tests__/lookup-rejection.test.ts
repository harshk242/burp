import { describe, expect, it } from 'vitest';
import { isRejectedLookup, UpstreamError } from '../exceptions.js';

function failure(status: number | null, kind = 'bad_request') {
  return new UpstreamError('rejected', { status, kind, reason: kind, platform: 'test', attempts: 1, elapsedMs: 0, retryAfterMs: null, url: null });
}

describe('endpoint lookup rejection', () => {
  it('defaults to genuine missing resources only', () => {
    expect(isRejectedLookup(failure(404, 'not_found'))).toBe(true);
    expect(isRejectedLookup(failure(400))).toBe(false);
    expect(isRejectedLookup(failure(null, 'not_found'))).toBe(false);
  });
  it('allows an endpoint to explicitly recognize invalid identifiers', () => {
    expect(isRejectedLookup(failure(400), [400])).toBe(true);
    expect(isRejectedLookup(failure(422), [400])).toBe(false);
  });
  it.each([401, 403, null])('propagates auth/config failures (%s) even with caller overrides', status => {
    expect(isRejectedLookup(failure(status), [400, 401, 403])).toBe(false);
  });
});
