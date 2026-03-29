// Re-export shared exceptions for ClinPGx platform
// Maps: ClinPGxError → MCPError, PharmGKBAPIError → APIError, etc.

export {
  MCPError as ClinPGxError,
  APIError as PharmGKBAPIError,
  NetworkError,
  ValidationError,
  CacheError,
  NotFoundError,
} from '../../shared/exceptions.js';
