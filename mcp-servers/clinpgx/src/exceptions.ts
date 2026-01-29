// Custom exception hierarchy for ClinPGx MCP

export class ClinPGxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClinPGxError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class PharmGKBAPIError extends ClinPGxError {
  public readonly statusCode?: number;
  public readonly errorDetails?: string;

  constructor(message: string, statusCode?: number, errorDetails?: string) {
    super(message);
    this.name = 'PharmGKBAPIError';
    this.statusCode = statusCode;
    this.errorDetails = errorDetails;
  }
}

export class NetworkError extends ClinPGxError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends ClinPGxError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class CacheError extends ClinPGxError {
  constructor(message: string) {
    super(message);
    this.name = 'CacheError';
  }
}

export class NotFoundError extends ClinPGxError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
