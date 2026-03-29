// PubMed platform exceptions
// Re-exports shared exceptions and provides platform-specific aliases

export {
  MCPError,
  APIError,
  RateLimitError,
  XMLParseError,
  NetworkError,
  ValidationError,
  CacheError,
  NotFoundError,
} from '../../shared/exceptions.js';

// Platform-specific alias for NCBI API errors
export { APIError as NCBIAPIError } from '../../shared/exceptions.js';
