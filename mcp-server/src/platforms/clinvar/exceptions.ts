// Re-export shared exceptions for ClinVar platform module
// Maps: ClinVarError -> MCPError, NCBIAPIError -> APIError, etc.

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

// Convenience aliases for backward compatibility within this platform
export { MCPError as ClinVarError } from '../../shared/exceptions.js';
export { APIError as NCBIAPIError } from '../../shared/exceptions.js';
