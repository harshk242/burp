# Database Codemap

**Updated:** 2026-10-09 | **Files:** 27 TS + 4 SQL migrations | **Engine:** SQLite (WAL, `bun:sqlite`) via Drizzle ORM 0.45.4 (exact pin)

## Entry Points

- `app/server/db/index.ts` — `db` (Drizzle), `sqlite` (raw handle), `DB_PATH`, `runMigrations`, `MigrationFkError`, and every `*Queries` object bound to the app connection. Import path for routes/middleware/orchestration.
- `app/server/index.ts` — calls `runMigrations(sqlite)` before listening; logs `database_migrated` or exits(1) on `database_migration_failed` / `database_migration_fk_violation`.
- `app/drizzle.config.ts` — drizzle-kit config (schema → `server/db/migrations`, filters `tool_search_fts*` and `__drizzle_migrations`).

## Layout (`app/server/db/`)

| Path | Role |
|------|------|
| `paths.ts` | DB path resolution (`:memory:` support), `MIGRATIONS_FOLDER`. No config/bun imports. |
| `connection.ts` | `openDatabase()` (pragmas: FKs on, WAL) + `createDrizzle()`. Side-effect free. |
| `client.ts` | Opens the app's single connection from `config.yaml`/`DATABASE_URL`. |
| `schema/{users,chat,usage}.ts` | Drizzle tables. Property keys = snake_case column names (rows are API shapes). |
| `queries/*.ts` | One factory per `*Queries` object (`createUserQueries(db)` …); `queries/index.ts` `createQueries(db)`. |
| `migrations/` | drizzle-kit output: `0000_baseline`, `0001_tool_search_fts` (custom), `0002_seed_and_data_fixes` (custom), `0003_tighten_not_null` (+ hand-prepended backfills), `meta/`. |
| `migrate.ts` | `runMigrations()`: backup → FKs off → one `BEGIN IMMEDIATE` txn { adopt legacy, apply pending, `foreign_key_check` } → commit → FKs on. |
| `executor.ts` | Mirrors drizzle-orm's `__drizzle_migrations` bookkeeping inside our transaction. |
| `legacy.ts`, `introspect.ts`, `sql-tokens.ts` | Adoption of pre-Drizzle DBs (catch-up ALTERs, fingerprint verify, canonical rebuild). |
| `backfills.ts`, `verify.ts` | `0003` backfill preview + `db:verify` report. |
| `cli/{migrate,verify,snapshot}.ts` | `db:migrate`, `db:verify`, `db:snapshot`. |

## Tables

`users`, `access_requests`, `chat_sessions`, `messages`, `daily_usage` (UNIQUE `user_id, date`), `rate_limits` (seeded `user`=50, `admin`=-1), `usage_events` (per-query cost ledger), plus `tool_search_fts` (FTS5 virtual table, porter tokenizer) and `__drizzle_migrations` (history). See `schema/*.ts` for columns, CHECKs, FKs and indexes.

## Query Layer (`db/queries/`)

| Object | Methods |
|--------|---------|
| `userQueries` | `findByClerkId`, `findByEmail`, `findById` (→ `null` when missing), `create`, `updateLastActive`, `incrementQueries`, `updateRole`, `updateLimits`, `listAll` |
| `accessRequestQueries` | `create`, `findByEmail`, `findById`, `findPending`, `findAll`, `approve`, `reject` |
| `chatSessionQueries` | `create`, `findByUserId`, `findById`, `updateTitle`, `touch`, `delete` |
| `messageQueries` | `create`, `findByChatId`, `findById` |
| `dailyUsageQueries` | `incrementAndGet` (single upsert `.returning()`), `getToday`, `getTodayFull`, `incrementTokens` (upsert with `excluded.*`) |
| `usageEventQueries` | `create`, `getTotalsForDate`, `getTotalsForMonth` (`coalesce(sum(...), 0)`, `count()`) |
| `rateLimitQueries` | `getForRole` (fallback -1 admin / 50 otherwise), `update` (upsert) |
| `toolSearchQueries` | `clearAll`, `insertTool`, `searchBM25` — raw `sql` (FTS5 `MATCH`/`rank`) |

All queries are synchronous. `db.transaction(() => …)` is a sync transaction on the same connection, so global `*Queries` calls inside it are transactional (`orchestration/chat-v2.ts`).

## Types

`DbUser`, `DbAccessRequest`, `DbChatSession`, `DbMessageRow`, `DbUsageEvent` (`server/types.ts`) are `$inferSelect`. `__tests__/db-row-types.typecheck.ts` asserts each is assignable to its Zod API type and that every non-null DB column is in the API type (`bun run typecheck`).

## Tests

- `__test-utils__/db.ts` `createTestDb()` — in-memory DB with all migrations.
- `db-queries-*.test.ts` (query layer), `db-migrations*.test.ts`, `db-legacy-*.test.ts`, `db-tighten*.test.ts`, `db-verify-snapshot.test.ts`, `boot.test.ts` (spawns the server on fresh / legacy / FK-violating DBs).
- CI (`.github/workflows/test.yml`): typecheck, `drizzle-kit check`, drift guard (`drizzle-kit generate` must produce no changes).

## Related Areas

- [INDEX](./INDEX.md) — Full overview
- [Backend](./backend.md) — Routes and orchestration that use these queries
- [Frontend](./frontend.md) — UI that displays persisted data
- `plans/drizzle-orm-migration.md` — design doc; README "Database" section for workflow and restore steps
