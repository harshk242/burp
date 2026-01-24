export declare class ClinVarError extends Error {
    constructor(message: string);
}
export declare class NCBIAPIError extends ClinVarError {
    readonly statusCode?: number;
    readonly errorDetails?: string;
    constructor(message: string, statusCode?: number, errorDetails?: string);
}
export declare class RateLimitError extends ClinVarError {
    readonly retryAfter?: number;
    constructor(message: string, retryAfter?: number);
}
export declare class XMLParseError extends ClinVarError {
    readonly rawContent?: string;
    constructor(message: string, rawContent?: string);
}
export declare class NetworkError extends ClinVarError {
    readonly statusCode?: number;
    constructor(message: string, statusCode?: number);
}
export declare class ValidationError extends ClinVarError {
    constructor(message: string);
}
export declare class CacheError extends ClinVarError {
    constructor(message: string);
}
//# sourceMappingURL=exceptions.d.ts.map