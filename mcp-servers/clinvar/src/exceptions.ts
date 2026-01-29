// Custom exception hierarchy for ClinVar MCP

export class ClinVarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClinVarError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NCBIAPIError extends ClinVarError {
  public readonly statusCode?: number;
  public readonly errorDetails?: string;

  constructor(message: string, statusCode?: number, errorDetails?: string) {
    super(message);
    this.name = 'NCBIAPIError';
    this.statusCode = statusCode;
    this.errorDetails = errorDetails;
  }
}

export class RateLimitError extends ClinVarError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class XMLParseError extends ClinVarError {
  public readonly rawContent?: string;

  constructor(message: string, rawContent?: string) {
    super(message);
    this.name = 'XMLParseError';
    this.rawContent = rawContent?.substring(0, 500);
  }
}

export class NetworkError extends ClinVarError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends ClinVarError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class CacheError extends ClinVarError {
  constructor(message: string) {
    super(message);
    this.name = 'CacheError';
  }
}
