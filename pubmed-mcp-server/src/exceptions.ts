// Custom exception hierarchy for PubMed MCP

export class PubMedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PubMedError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NCBIAPIError extends PubMedError {
  public readonly statusCode?: number;
  public readonly errorDetails?: string;

  constructor(message: string, statusCode?: number, errorDetails?: string) {
    super(message);
    this.name = 'NCBIAPIError';
    this.statusCode = statusCode;
    this.errorDetails = errorDetails;
  }
}

export class RateLimitError extends PubMedError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class XMLParseError extends PubMedError {
  public readonly rawContent?: string;

  constructor(message: string, rawContent?: string) {
    super(message);
    this.name = 'XMLParseError';
    this.rawContent = rawContent?.substring(0, 500); // Truncate for logging
  }
}

export class NetworkError extends PubMedError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends PubMedError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class CacheError extends PubMedError {
  constructor(message: string) {
    super(message);
    this.name = 'CacheError';
  }
}
