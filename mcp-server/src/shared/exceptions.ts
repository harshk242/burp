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
