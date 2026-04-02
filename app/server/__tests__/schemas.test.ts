/**
 * Unit tests for Zod schemas in server/schemas/index.ts.
 *
 * These are pure validation tests — no I/O, no database, no auth.
 * They ensure the schema contracts are correct and stay correct as
 * the codebase evolves.
 */

import { describe, it, expect } from 'bun:test';
import {
  ChatRequestSchema,
  CreateSessionSchema,
  UpdateSessionSchema,
  ErrorSchema,
  MessageSchema,
  UserSchema,
  UsageSchema,
  SessionCreatedSchema,
  ChatSessionSchema,
  MCPToolSchema,
  ToolListSchema,
} from '../schemas/index.ts';

// ── ChatRequestSchema ─────────────────────────────────────────────────────────

describe('ChatRequestSchema', () => {
  it('accepts a message with no sessionId', () => {
    const result = ChatRequestSchema.safeParse({ message: 'What are EGFR inhibitors?' });
    expect(result.success).toBe(true);
  });

  it('accepts a message with a valid UUID sessionId', () => {
    const result = ChatRequestSchema.safeParse({
      message: 'Tell me about BRCA1',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty message', () => {
    const result = ChatRequestSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing message field', () => {
    const result = ChatRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID sessionId', () => {
    const result = ChatRequestSchema.safeParse({
      message: 'hello',
      sessionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

// ── CreateSessionSchema ───────────────────────────────────────────────────────

describe('CreateSessionSchema', () => {
  it('accepts an empty object (title is optional)', () => {
    const result = CreateSessionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a title string', () => {
    const result = CreateSessionSchema.safeParse({ title: 'BRCA1 Research' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.title).toBe('BRCA1 Research');
  });

  it('title is undefined when omitted', () => {
    const result = CreateSessionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.title).toBeUndefined();
  });
});

// ── UpdateSessionSchema ───────────────────────────────────────────────────────

describe('UpdateSessionSchema', () => {
  it('accepts a non-empty title', () => {
    const result = UpdateSessionSchema.safeParse({ title: 'New Title' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty title', () => {
    const result = UpdateSessionSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing title', () => {
    const result = UpdateSessionSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── ErrorSchema ───────────────────────────────────────────────────────────────

describe('ErrorSchema', () => {
  it('accepts a string error', () => {
    const result = ErrorSchema.safeParse({ error: 'Something went wrong' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing error field', () => {
    const result = ErrorSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a numeric error', () => {
    const result = ErrorSchema.safeParse({ error: 500 });
    expect(result.success).toBe(false);
  });
});

// ── MessageSchema ─────────────────────────────────────────────────────────────

describe('MessageSchema', () => {
  it('accepts a string message', () => {
    const result = MessageSchema.safeParse({ message: 'Session deleted' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing message field', () => {
    const result = MessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── UserSchema ────────────────────────────────────────────────────────────────

describe('UserSchema', () => {
  const validUser = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clerk_id: 'user_2abc123',
    email: 'user@example.com',
    name: 'Jane Doe',
    image_url: 'https://example.com/avatar.jpg',
    role: 'user' as const,
    institution: 'MIT',
    research_area: 'Computational Biology',
    total_queries: 42,
    created_at: 1706371200,
    last_active_at: 1706371200,
  };

  it('accepts a fully populated user', () => {
    const result = UserSchema.safeParse(validUser);
    expect(result.success).toBe(true);
  });

  it('accepts a user with null nullable fields', () => {
    const result = UserSchema.safeParse({
      ...validUser,
      name: null,
      image_url: null,
      institution: null,
      research_area: null,
      last_active_at: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all role values', () => {
    for (const role of ['waitlist', 'user', 'admin'] as const) {
      const result = UserSchema.safeParse({ ...validUser, role });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid role', () => {
    const result = UserSchema.safeParse({ ...validUser, role: 'superadmin' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID id', () => {
    const result = UserSchema.safeParse({ ...validUser, id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-email email', () => {
    const result = UserSchema.safeParse({ ...validUser, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });
});

// ── UsageSchema ───────────────────────────────────────────────────────────────

describe('UsageSchema', () => {
  const validUsage = {
    used: 12,
    limit: 50,
    remaining: 38,
    resetAt: 1711497600,
    total_queries: 142,
    role: 'user' as const,
  };

  it('accepts valid usage data', () => {
    const result = UsageSchema.safeParse(validUsage);
    expect(result.success).toBe(true);
  });

  it('accepts limit of -1 (unlimited)', () => {
    const result = UsageSchema.safeParse({ ...validUsage, limit: -1 });
    expect(result.success).toBe(true);
  });

  it('rejects non-integer used count', () => {
    const result = UsageSchema.safeParse({ ...validUsage, used: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { remaining: _omitted, ...incomplete } = validUsage;
    const result = UsageSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });
});

// ── SessionCreatedSchema ──────────────────────────────────────────────────────

describe('SessionCreatedSchema', () => {
  it('accepts valid id and title', () => {
    const result = SessionCreatedSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'New Chat',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    const result = SessionCreatedSchema.safeParse({ id: 'bad', title: 'New Chat' });
    expect(result.success).toBe(false);
  });
});

// ── ChatSessionSchema ─────────────────────────────────────────────────────────

describe('ChatSessionSchema', () => {
  it('accepts a session with all fields', () => {
    const result = ChatSessionSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      user_id: '660e8400-e29b-41d4-a716-446655440111',
      title: 'EGFR Research',
      created_at: 1706371200,
      updated_at: 1706371300,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null for title and updated_at', () => {
    const result = ChatSessionSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      user_id: '660e8400-e29b-41d4-a716-446655440111',
      title: null,
      created_at: 1706371200,
      updated_at: null,
    });
    expect(result.success).toBe(true);
  });
});

// ── MCPToolSchema / ToolListSchema ────────────────────────────────────────────

describe('MCPToolSchema', () => {
  const validTool = {
    name: 'search_proteins',
    description: 'Search for proteins by name or accession',
    server: 'uniprot',
    inputSchema: { type: 'object' },
    available: true,
  };

  it('accepts a valid tool definition', () => {
    const result = MCPToolSchema.safeParse(validTool);
    expect(result.success).toBe(true);
  });

  it('accepts available: false', () => {
    const result = MCPToolSchema.safeParse({ ...validTool, available: false });
    expect(result.success).toBe(true);
  });

  it('rejects a missing name', () => {
    const { name: _omitted, ...noName } = validTool;
    const result = MCPToolSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });
});

describe('ToolListSchema', () => {
  it('accepts an empty tool list', () => {
    const result = ToolListSchema.safeParse({ tools: [] });
    expect(result.success).toBe(true);
  });

  it('accepts a list with a count', () => {
    const result = ToolListSchema.safeParse({
      tools: [],
      count: 0,
    });
    expect(result.success).toBe(true);
  });
});
