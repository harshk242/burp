// Custom exception hierarchy for Open Targets MCP
export class OpenTargetsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'OpenTargetsError';
        Error.captureStackTrace(this, this.constructor);
    }
}
export class OpenTargetsAPIError extends OpenTargetsError {
    errors;
    constructor(message, errors = []) {
        super(message);
        this.name = 'OpenTargetsAPIError';
        this.errors = errors;
    }
}
export class GraphQLError extends OpenTargetsAPIError {
    constructor(message, errors = []) {
        super(message, errors);
        this.name = 'GraphQLError';
    }
}
export class NetworkError extends OpenTargetsError {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = 'NetworkError';
        this.statusCode = statusCode;
    }
}
export class ValidationError extends OpenTargetsError {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
export class CacheError extends OpenTargetsError {
    constructor(message) {
        super(message);
        this.name = 'CacheError';
    }
}
//# sourceMappingURL=exceptions.js.map