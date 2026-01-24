export declare class PubMedError extends Error {
    constructor(message: string);
}
export declare class NCBIAPIError extends PubMedError {
    readonly statusCode?: number;
    readonly errorDetails?: string;
    constructor(message: string, statusCode?: number, errorDetails?: string);
}
export declare class RateLimitError extends PubMedError {
    readonly retryAfter?: number;
    constructor(message: string, retryAfter?: number);
}
export declare class XMLParseError extends PubMedError {
    readonly rawContent?: string;
    constructor(message: string, rawContent?: string);
}
export declare class NetworkError extends PubMedError {
    readonly statusCode?: number;
    constructor(message: string, statusCode?: number);
}
export declare class ValidationError extends PubMedError {
    constructor(message: string);
}
export declare class CacheError extends PubMedError {
    constructor(message: string);
}
//# sourceMappingURL=exceptions.d.ts.map