# Database Codemap

**Generated:** 2026-03-13 | **Files:** 3 | **Lines:** 268 | **Engine:** SQLite (WAL mode, Bun native driver)

## Entry Points

- `app/server/db/index.ts` (198) — Connection setup, query builders
- `app/server/db/schema.sql` (61) — Table definitions
- `app/server/db/init.ts` (9) — One-time schema initialization

## Schema

```sql
users                              # Clerk-synced user profiles
├── id                  TEXT PK
├── clerk_id            TEXT UNIQUE
├── email               TEXT UNIQUE
├── name, image_url     TEXT
├── role                TEXT       # waitlist | user | admin
├── institution         TEXT
├── research_area       TEXT
├── total_queries       INT
├── created_at          DATETIME
└── last_active_at      DATETIME

access_requests                    # Waitlist management
├── id                  TEXT PK
├── email               TEXT UNIQUE
├── name, institution   TEXT
├── research_area       TEXT
├── use_case            TEXT
├── status              TEXT       # pending | approved | rejected
├── submitted_at        DATETIME
├── reviewed_at         DATETIME
└── reviewed_by         TEXT FK → users.id (ON DELETE SET NULL)

chat_sessions                      # Conversation containers
├── id                  TEXT PK
├── user_id             TEXT FK → users.id (ON DELETE CASCADE)
├── title               TEXT       # Auto-generated or "New Chat"
├── created_at          DATETIME
└── updated_at          DATETIME

messages                           # Chat messages
├── id                  TEXT PK
├── chat_id             TEXT FK → chat_sessions.id (ON DELETE CASCADE)
├── role                TEXT       # user | assistant
├── content             TEXT       # Nullable (tool-only messages)
├── tool_calls          TEXT       # JSON array, nullable
└── created_at          DATETIME
```

## Indexes

```
idx_users_clerk_id        ON users(clerk_id)
idx_users_email           ON users(email)
idx_access_requests_email ON access_requests(email)
idx_access_status         ON access_requests(status)
idx_messages_chat_id      ON messages(chat_id)
```

## Query Layer (`db/index.ts`)

Key query builders exposed:

| Function | Purpose |
|----------|---------|
| `getUserByClerkId(id)` | Lookup user by Clerk ID |
| `upsertUser(data)` | Insert or update user profile |
| `createSession(userId, title)` | New chat session |
| `getSessionsByUser(userId)` | List sessions, newest first |
| `deleteSession(id)` | Remove session + cascade messages |
| `insertMessage(chatId, role, content, toolCalls)` | Persist message |
| `getMessagesBySession(chatId)` | Load conversation history |
| `createAccessRequest(data)` | Submit waitlist application |
| `updateAccessRequest(id, status, reviewerId)` | Approve/reject |

## Configuration

- **WAL mode** enabled for concurrent reads during streaming
- **Foreign keys** enforced
- **Statement caching** for prepared statement reuse
- **Location:** `data/app.db`

## Related Areas

- [INDEX](./INDEX.md) — Full overview
- [Backend](./backend.md) — Routes and orchestration that use these queries
- [Frontend](./frontend.md) — UI that displays persisted data
