// Custom exception hierarchy for ClinVar MCP
export class ClinVarError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ClinVarError';
        Error.captureStackTrace(this, this.constructor);
    }
}
export class NCBIAPIError extends ClinVarError {
    statusCode;
    errorDetails;
    constructor(message, statusCode, errorDetails) {
        super(message);
        this.name = 'NCBIAPIError';
        this.statusCode = statusCode;
        this.errorDetails = errorDetails;
    }
}
export class RateLimitError extends ClinVarError {
    retryAfter;
    constructor(message, retryAfter) {
        super(message);
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}
export class XMLParseError extends ClinVarError {
    rawContent;
    constructor(message, rawContent) {
        super(message);
        this.name = 'XMLParseError';
        this.rawContent = rawContent?.substring(0, 500);
    }
}
export class NetworkError extends ClinVarError {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = 'NetworkError';
        this.statusCode = statusCode;
    }
}
export class ValidationError extends ClinVarError {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
export class CacheError extends ClinVarError {
    constructor(message) {
        super(message);
        this.name = 'CacheError';
    }
}
//# sourceMappingURL=exceptions.js.map