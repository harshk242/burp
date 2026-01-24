// Custom exception hierarchy for PubMed MCP
export class PubMedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PubMedError';
        Error.captureStackTrace(this, this.constructor);
    }
}
export class NCBIAPIError extends PubMedError {
    statusCode;
    errorDetails;
    constructor(message, statusCode, errorDetails) {
        super(message);
        this.name = 'NCBIAPIError';
        this.statusCode = statusCode;
        this.errorDetails = errorDetails;
    }
}
export class RateLimitError extends PubMedError {
    retryAfter;
    constructor(message, retryAfter) {
        super(message);
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}
export class XMLParseError extends PubMedError {
    rawContent;
    constructor(message, rawContent) {
        super(message);
        this.name = 'XMLParseError';
        this.rawContent = rawContent?.substring(0, 500); // Truncate for logging
    }
}
export class NetworkError extends PubMedError {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = 'NetworkError';
        this.statusCode = statusCode;
    }
}
export class ValidationError extends PubMedError {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
export class CacheError extends PubMedError {
    constructor(message) {
        super(message);
        this.name = 'CacheError';
    }
}
//# sourceMappingURL=exceptions.js.map