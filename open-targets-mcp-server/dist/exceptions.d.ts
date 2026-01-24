export declare class OpenTargetsError extends Error {
    constructor(message: string);
}
export declare class OpenTargetsAPIError extends OpenTargetsError {
    readonly errors: Array<{
        message: string;
        path?: string[];
    }>;
    constructor(message: string, errors?: Array<{
        message: string;
        path?: string[];
    }>);
}
export declare class GraphQLError extends OpenTargetsAPIError {
    constructor(message: string, errors?: Array<{
        message: string;
        path?: string[];
    }>);
}
export declare class NetworkError extends OpenTargetsError {
    readonly statusCode?: number;
    constructor(message: string, statusCode?: number);
}
export declare class ValidationError extends OpenTargetsError {
    constructor(message: string);
}
export declare class CacheError extends OpenTargetsError {
    constructor(message: string);
}
//# sourceMappingURL=exceptions.d.ts.map