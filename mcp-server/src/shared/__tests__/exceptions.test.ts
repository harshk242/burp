import { describe, it, expect } from 'vitest';
import {
  MCPError,
  APIError,
  GraphQLError,
  RateLimitError,
  XMLParseError,
  NetworkError,
  ValidationError,
  NotFoundError,
  CacheError,
} from '../exceptions.js';

describe('MCPError', () => {
  it('sets message correctly', () => {
    expect(new MCPError('test error').message).toBe('test error');
  });

  it('sets name to MCPError', () => {
    expect(new MCPError('x').name).toBe('MCPError');
  });

  it('is instanceof Error and MCPError', () => {
    const err = new MCPError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MCPError);
  });

  it('has a stack trace', () => {
    expect(new MCPError('x').stack).toBeDefined();
  });
});

describe('APIError', () => {
  it('extends MCPError', () => {
    expect(new APIError('x')).toBeInstanceOf(MCPError);
  });

  it('sets name to APIError', () => {
    expect(new APIError('x').name).toBe('APIError');
  });

  it('stores optional statusCode', () => {
    expect(new APIError('x', 404).statusCode).toBe(404);
    expect(new APIError('x').statusCode).toBeUndefined();
  });

  it('stores optional errorDetails', () => {
    expect(new APIError('x', 400, 'bad field').errorDetails).toBe('bad field');
    expect(new APIError('x').errorDetails).toBeUndefined();
  });
});

describe('GraphQLError', () => {
  it('extends APIError', () => {
    expect(new GraphQLError('x')).toBeInstanceOf(APIError);
  });

  it('sets name to GraphQLError', () => {
    expect(new GraphQLError('x').name).toBe('GraphQLError');
  });

  it('stores the errors array', () => {
    const errors = [{ message: 'field not found', path: ['target', 'id'] }];
    expect(new GraphQLError('gql failed', errors).errors).toEqual(errors);
  });

  it('defaults errors to empty array', () => {
    expect(new GraphQLError('x').errors).toEqual([]);
  });
});

describe('RateLimitError', () => {
  it('extends MCPError', () => {
    expect(new RateLimitError('x')).toBeInstanceOf(MCPError);
  });

  it('sets name to RateLimitError', () => {
    expect(new RateLimitError('x').name).toBe('RateLimitError');
  });

  it('stores optional retryAfter in ms', () => {
    expect(new RateLimitError('x', 5000).retryAfter).toBe(5000);
    expect(new RateLimitError('x').retryAfter).toBeUndefined();
  });
});

describe('XMLParseError', () => {
  it('extends MCPError', () => {
    expect(new XMLParseError('x')).toBeInstanceOf(MCPError);
  });

  it('sets name to XMLParseError', () => {
    expect(new XMLParseError('x').name).toBe('XMLParseError');
  });

  it('truncates rawContent to 500 chars', () => {
    const longContent = 'a'.repeat(600);
    expect(new XMLParseError('x', longContent).rawContent).toHaveLength(500);
  });

  it('preserves rawContent under 500 chars', () => {
    expect(new XMLParseError('x', '<root/>').rawContent).toBe('<root/>');
  });

  it('rawContent is undefined when not provided', () => {
    expect(new XMLParseError('x').rawContent).toBeUndefined();
  });
});

describe('NetworkError', () => {
  it('extends MCPError', () => {
    expect(new NetworkError('x')).toBeInstanceOf(MCPError);
  });

  it('sets name to NetworkError', () => {
    expect(new NetworkError('x').name).toBe('NetworkError');
  });

  it('stores optional statusCode', () => {
    expect(new NetworkError('x', 503).statusCode).toBe(503);
    expect(new NetworkError('x').statusCode).toBeUndefined();
  });
});

describe('ValidationError', () => {
  it('extends MCPError', () => {
    expect(new ValidationError('x')).toBeInstanceOf(MCPError);
  });

  it('sets name to ValidationError', () => {
    expect(new ValidationError('x').name).toBe('ValidationError');
  });
});

describe('NotFoundError', () => {
  it('extends MCPError', () => {
    expect(new NotFoundError('x')).toBeInstanceOf(MCPError);
  });

  it('sets name to NotFoundError', () => {
    expect(new NotFoundError('x').name).toBe('NotFoundError');
  });
});

describe('CacheError', () => {
  it('extends MCPError', () => {
    expect(new CacheError('x')).toBeInstanceOf(MCPError);
  });

  it('sets name to CacheError', () => {
    expect(new CacheError('x').name).toBe('CacheError');
  });
});

describe('instanceof hierarchy', () => {
  it('GraphQLError is instanceof APIError, MCPError, Error', () => {
    const err = new GraphQLError('x');
    expect(err).toBeInstanceOf(GraphQLError);
    expect(err).toBeInstanceOf(APIError);
    expect(err).toBeInstanceOf(MCPError);
    expect(err).toBeInstanceOf(Error);
  });

  it('all custom errors are instanceof MCPError', () => {
    const errors = [
      new APIError('x'),
      new GraphQLError('x'),
      new RateLimitError('x'),
      new XMLParseError('x'),
      new NetworkError('x'),
      new ValidationError('x'),
      new NotFoundError('x'),
      new CacheError('x'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(MCPError);
      expect(err).toBeInstanceOf(Error);
    }
  });
});
