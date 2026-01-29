// Custom exception hierarchy for Open Targets MCP

export class OpenTargetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenTargetsError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class OpenTargetsAPIError extends OpenTargetsError {
  public readonly errors: Array<{ message: string; path?: string[] }>;

  constructor(message: string, errors: Array<{ message: string; path?: string[] }> = []) {
    super(message);
    this.name = 'OpenTargetsAPIError';
    this.errors = errors;
  }
}

export class GraphQLError extends OpenTargetsAPIError {
  constructor(message: string, errors: Array<{ message: string; path?: string[] }> = []) {
    super(message, errors);
    this.name = 'GraphQLError';
  }
}

export class NetworkError extends OpenTargetsError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends OpenTargetsError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class CacheError extends OpenTargetsError {
  constructor(message: string) {
    super(message);
    this.name = 'CacheError';
  }
}
