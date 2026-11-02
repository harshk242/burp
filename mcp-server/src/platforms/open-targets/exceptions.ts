import { MCPError, APIError, GraphQLError as SharedGraphQLError } from '../../shared/exceptions.js';

export class OpenTargetsError extends MCPError {
  constructor(message: string) {
    super(message);
    this.name = 'OpenTargetsError';
  }
}

export class OpenTargetsAPIError extends APIError {
  public readonly errors: Array<{ message: string; path?: string[] }>;

  constructor(message: string, errors: Array<{ message: string; path?: string[] }> = []) {
    super(message);
    this.name = 'OpenTargetsAPIError';
    this.errors = errors;
  }
}

export class GraphQLError extends SharedGraphQLError {
  constructor(message: string, errors: Array<{ message: string; path?: string[] }> = []) {
    super(message, errors);
    this.name = 'GraphQLError';
  }
}

export { NetworkError, ValidationError, CacheError } from '../../shared/exceptions.js';
