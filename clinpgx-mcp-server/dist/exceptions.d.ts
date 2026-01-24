export declare class ClinPGxError extends Error {
    constructor(message: string);
}
export declare class PharmGKBAPIError extends ClinPGxError {
    readonly statusCode?: number;
    readonly errorDetails?: string;
    constructor(message: string, statusCode?: number, errorDetails?: string);
}
export declare class NetworkError extends ClinPGxError {
    readonly statusCode?: number;
    constructor(message: string, statusCode?: number);
}
export declare class ValidationError extends ClinPGxError {
    constructor(message: string);
}
export declare class CacheError extends ClinPGxError {
    constructor(message: string);
}
export declare class NotFoundError extends ClinPGxError {
    constructor(message: string);
}
//# sourceMappingURL=exceptions.d.ts.map