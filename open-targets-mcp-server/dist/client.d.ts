export interface OpenTargetsClientOptions {
    baseUrl?: string;
    cacheTtl?: number;
    maxRetries?: number;
    retryDelay?: number;
}
export declare class OpenTargetsClient {
    private readonly baseUrl;
    private readonly cacheTtl;
    private readonly maxRetries;
    private readonly retryDelay;
    private readonly cache;
    private axiosInstance;
    constructor(options?: OpenTargetsClientOptions);
    /**
     * Execute a GraphQL query with caching and retry logic
     */
    query<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
    /**
     * Clear the cache
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: number;
        entries: number;
    };
}
/**
 * Initialize the global client
 */
export declare function initializeClient(options?: OpenTargetsClientOptions): OpenTargetsClient;
/**
 * Get the global client instance
 */
export declare function getClient(): OpenTargetsClient;
/**
 * Close the global client (cleanup)
 */
export declare function closeClient(): void;
//# sourceMappingURL=client.d.ts.map