// Shared exception hierarchy across all platforms

export class MCPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class APIError extends MCPError {
  public readonly statusCode?: number;
  public readonly errorDetails?: string;

  constructor(message: string, statusCode?: number, errorDetails?: string) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.errorDetails = errorDetails;
  }
}

export class GraphQLError extends APIError {
  public readonly errors: Array<{ message: string; path?: string[] }>;

  constructor(message: string, errors: Array<{ message: string; path?: string[] }> = []) {
    super(message);
    this.name = 'GraphQLError';
    this.errors = errors;
  }
}

export class RateLimitError extends MCPError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class XMLParseError extends MCPError {
  public readonly rawContent?: string;

  constructor(message: string, rawContent?: string) {
    super(message);
    this.name = 'XMLParseError';
    this.rawContent = rawContent?.substring(0, 500);
  }
}

export class NetworkError extends MCPError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends MCPError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends MCPError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class CacheError extends MCPError {
  constructor(message: string) {
    super(message);
    this.name = 'CacheError';
  }
}

export interface UpstreamErrorDetails {
  kind: string;
  reason: string;
  platform: string;
  status: number | null;
  attempts: number;
  elapsedMs: number;
  retryAfterMs: number | null;
  url: string | null;
  cause?: unknown;
}

/**
 * Final failure of a retried upstream HTTP request (shared/http-retry.ts).
 * `cause` is the last AxiosError (or abort reason); `url` is the path only.
 */
export class UpstreamError extends MCPError {
  public readonly kind: string;
  public readonly reason: string;
  public readonly platform: string;
  public readonly status: number | null;
  public readonly attempts: number;
  public readonly elapsedMs: number;
  public readonly retryAfterMs: number | null;
  public readonly url: string | null;
  public override readonly cause?: unknown;

  constructor(message: string, details: UpstreamErrorDetails) {
    super(message);
    this.name = 'UpstreamError';
    this.kind = details.kind;
    this.reason = details.reason;
    this.platform = details.platform;
    this.status = details.status;
    this.attempts = details.attempts;
    this.elapsedMs = details.elapsedMs;
    this.retryAfterMs = details.retryAfterMs;
    this.url = details.url;
    this.cause = details.cause;
  }
}

/**
 * True when the upstream rejected the lookup itself (404 or another 4xx), so
 * "not found" is an honest answer. Outages, timeouts, rate limits and
 * non-upstream errors are not, and must be rethrown.
 */
export function isRejectedLookup(error: unknown): error is UpstreamError {
  return error instanceof UpstreamError && (error.kind === 'not_found' || error.kind === 'bad_request');
}
