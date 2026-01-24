// Custom exception hierarchy for ClinPGx MCP
export class ClinPGxError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ClinPGxError';
        Error.captureStackTrace(this, this.constructor);
    }
}
export class PharmGKBAPIError extends ClinPGxError {
    statusCode;
    errorDetails;
    constructor(message, statusCode, errorDetails) {
        super(message);
        this.name = 'PharmGKBAPIError';
        this.statusCode = statusCode;
        this.errorDetails = errorDetails;
    }
}
export class NetworkError extends ClinPGxError {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = 'NetworkError';
        this.statusCode = statusCode;
    }
}
export class ValidationError extends ClinPGxError {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
export class CacheError extends ClinPGxError {
    constructor(message) {
        super(message);
        this.name = 'CacheError';
    }
}
export class NotFoundError extends ClinPGxError {
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
    }
}
//# sourceMappingURL=exceptions.js.map