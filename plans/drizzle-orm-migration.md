# Drizzle ORM + drizzle-kit Migration Plan

## Context

Move the BURP backend database layer from hand-written SQL (`schema.sql` + try/catch `ALTER` list + raw `bun:sqlite` statements) to Drizzle ORM with a code-defined schema, drizzle-kit generated migrations, and a recorded migration history.

### Decisions

1. **snake_case property keys** (`clerk_id: text("clerk_id")`). Routes return DB rows directly, so keys are the API field names. snake_case keeps the API, Zod schemas, OpenAPI docs and web frontend unchanged (~180 field references). A camelCase rename is a separate, cosmetic refactor; it is out of scope here.
2. **Auto-adopt the legacy DB at boot** in `runMigrations()`, not a manual `fly ssh` script. Boot-time adoption has no window between deploy and adoption where the app is down or mismatched, and dev DBs adopt themselves too. `db:verify` on a prod snapshot runs the same adoption beforehand, so you still see diffs before deploy. `legacy.ts` is deleted once every DB is adopted (§11, Phase 7).
3. **NULL `users.role` backfills to `'user'`** (§5). A NULL role can only come from manual SQL or a bug, since no code path writes it. Today it acts as an accidental lockout (`requireRole` → 403). `'user'` matches where `0002` and the login upgrade in `middleware/clerk.ts` already send every account.

Resolved by review: schema tightening is **no longer optional**. A faithful nullable port can't satisfy the Zod API types (non-null `role`, counters, timestamps), so `0003_tighten_not_null` ships before the query layer switches to `$inferSelect` types (§4 Types, §11).

---

## 1. Current state

| Area | Today |
|---|---|
| Driver | `bun:sqlite`, single connection, `PRAGMA foreign_keys=ON`, WAL (`app/server/db/index.ts:22-28`) |
| Schema | `app/server/db/schema.sql` — 7 tables, 10 indexes, FTS5 virtual table (`tool_search_fts`), `rate_limits` seed rows |
| Migrations | `applyMigrations()` — a list of ALTERs with every error swallowed (`index.ts:46-92`). No record of what ran; real failures are hidden too |
| Startup | `initializeSchema()` on every boot (`server/index.ts:17`) + `bun run db:init` |
| Query layer | 7 `*Queries` objects with raw SQL, all **synchronous**, cached prepared statements |
| Row types | `DbUser` etc. derived from **Zod API schemas** (`types.ts:14-25`), not the DB — can drift |
| Call sites | `routes/{usage,chat,sessions,admin,waitlist}.ts`, `middleware/{clerk,rateLimit}.ts`, `search/hybrid-search.ts`, `orchestration/chat-v2.ts` (one `db.transaction(...)()` at L694), `scripts/approve-access.ts` (raw) |
| Deploy | Fly, 1 machine, SQLite (WAL) on volume `/app/data/app.db`; Dockerfile copies only `app/server`; no `sqlite3` CLI in the image |

### Constraints that drive the design

- **Prod DB already exists** → the first Drizzle migration can't just `CREATE TABLE`; needs a baseline/adoption step.
- **Legacy DDL quirks Drizzle can't reproduce** → anonymous inline `UNIQUE` constraints (`sqlite_autoindex_*`), columns appended by `ALTER` in a different order. Adoption therefore **rebuilds** legacy tables into the canonical baseline representation (§6) rather than only marking the baseline applied.
- **Fly `release_command` runs on an ephemeral machine without volumes** → migrations must run at app boot, not as a release step.
- **API returns DB rows directly in snake_case** (`clerk_id`, `created_at` …) → Drizzle property keys must stay snake_case or the API shape changes.
- **Everything is sync** → `drizzle-orm/bun-sqlite` provides sync `.get()/.all()/.run()` and sync transactions, so no async ripple through ~60 call sites.
- **FTS5 virtual tables aren't modelable in Drizzle** → custom migration.
- **Drizzle's `migrate()` commits before we can validate** → FK checks must run inside the migration transaction, so we use our own executor over Drizzle's migration files (§7).

## 2. Versions & deps

```bash
bun add drizzle-orm@0.45.4 --cwd app                     # exact pin: §7 mirrors migrator internals
bun add -d drizzle-kit@0.31.11 @libsql/client --cwd app  # libsql only for studio/pull
```

- Stable at time of writing: drizzle-orm `0.45.4`, drizzle-kit `0.31.11`. v1 is `1.0.0-beta.22` (changes migration folder format). Stay stable; `drizzle-kit up` when v1 ships.
- **Exact pins, not `^`**: the custom executor (§7) reproduces the `__drizzle_migrations` bookkeeping of `drizzle-orm/src/sqlite-core/dialect.ts` 0.45.4. Upgrades are deliberate and gated by the compatibility test in §10.
- `generate`/`check` need no driver. `studio`/`pull` need one → `@libsql/client` as devDep.
- Runtime migrations use `readMigrationFiles()` from `drizzle-orm/migrator` + our executor (no `drizzle-kit migrate`, no native modules).
- Dockerfile installs from `app/bun.lock` — make sure it is refreshed alongside the root lockfile.

## 3. File layout (each file < 500 LOC)

```
app/
  drizzle.config.ts
  server/db/
    paths.ts              # DB path resolution (extracted from index.ts) + ":memory:" support
    client.ts             # Database + pragmas + drizzle({ client, schema }); exports `db`, `sqlite`
    schema/
      users.ts            # users, accessRequests
      chat.ts             # chatSessions, messages
      usage.ts            # dailyUsage, rateLimits, usageEvents
      index.ts            # re-exports
    migrate.ts            # runMigrations(): backup → one transaction { adopt legacy, apply pending, FK check } → commit
    executor.ts           # applies Drizzle migration files + __drizzle_migrations rows inside a caller-owned transaction
    legacy.ts             # adoption: frozen old ALTER list, semantic verify, canonical rebuild
    introspect.ts         # schema fingerprint: columns, PKs, FKs, unique sets, CHECKs, indexes (used by legacy.ts + verify)
    migrations/           # drizzle-kit output (SQL + meta/_journal.json + snapshots)
    queries/
      users.ts  access-requests.ts  chat-sessions.ts  messages.ts
      usage.ts  rate-limits.ts  tool-search.ts
    index.ts              # re-exports db, sqlite, runMigrations, all *Queries (import paths unchanged)
    cli/migrate.ts        # `bun run db:migrate`
    cli/verify.ts         # `bun run db:verify <path>` — dry-run adoption + migrations on a copy, report diffs/backfills
    cli/snapshot.ts       # `bun run db:snapshot <out>` — VACUUM INTO a consistent copy (prod download, §6)
```

Removed (via `gio trash`): `schema.sql`, `init.ts`, `initializeSchema()`/`applyMigrations()`.

### `drizzle.config.ts`

```ts
export default defineConfig({
  dialect: "sqlite",
  schema: "./server/db/schema/index.ts",
  out: "./server/db/migrations",
  dbCredentials: { url: resolveDbPath() },          // from paths.ts; only used by studio/pull
  tablesFilter: ["!tool_search_fts*", "!__drizzle_migrations"],
  strict: true, verbose: true,
});
```

## 4. Schema in code

Faithful 1:1 port of `schema.sql` so migration `0000` describes what prod already has (semantically — §6 handles representation differences).

- **Keys = column names in snake_case**: `clerk_id: text("clerk_id").notNull().unique()`. Rows keep their current shape.
- **Preserve quirks exactly** (e.g. `created_at` is `DEFAULT (unixepoch())` with no NOT NULL → nullable). Tightening happens in `0003` (§5), not in the baseline.
- **Primary keys — table-level, never `.primaryKey()` on text columns in the baseline.** Drizzle's column-level `.primaryKey()` emits `PRIMARY KEY NOT NULL` ([column-builder.ts](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/column-builder.ts#L270-L281)), but legacy text PKs are nullable (`notnull=0` — a SQLite quirk for non-INTEGER PKs), so adoption comparison would fail. Use `primaryKey({ columns: [t.id] })`, which emits `PRIMARY KEY("id")` without NOT NULL.

  PK audit:

  | Table | Legacy | Baseline (`0000`) | After `0003` |
  |---|---|---|---|
  | `users.id` | `TEXT PRIMARY KEY` (nullable) | `primaryKey({ columns: [t.id] })` | `.primaryKey()` (NOT NULL) |
  | `access_requests.id` | same | same | same |
  | `chat_sessions.id` | same | same | same |
  | `messages.id` | same | same | same |
  | `usage_events.id` | same | same | same |
  | `rate_limits.role` | `TEXT PRIMARY KEY CHECK (...)` | `primaryKey({ columns: [t.role] })` + check | `.primaryKey()` |
  | `daily_usage.id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `integer().primaryKey({ autoIncrement: true })` | unchanged |

  `daily_usage.id` is a rowid alias, so it can never hold NULL; the emitted `NOT NULL` is semantically identical. The fingerprint (§6) treats `notnull` on an INTEGER rowid-alias PK as implied. It also compares `AUTOINCREMENT` presence explicitly, because `PRAGMA table_info` doesn't show it.

```ts
export const users = sqliteTable("users", {
  id: text("id"),
  clerk_id: text("clerk_id").notNull().unique(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["waitlist", "user", "admin"] }).default("waitlist"),
  total_queries: integer("total_queries").default(0),
  created_at: integer("created_at").default(sql`(unixepoch())`),
  daily_cost_limit_microusd: integer("daily_cost_limit_microusd"),
  // …
}, (t) => [
  primaryKey({ columns: [t.id] }),               // NOT .primaryKey() — keeps legacy nullability
  check("users_role_check", sql`role IN ('waitlist','user','admin')`),  // unqualified → stable fingerprint
  index("idx_users_clerk_id").on(t.clerk_id),   // kept for parity; dropped in Phase 6
  index("idx_users_email").on(t.email),
]);
```

- FKs via `.references(() => users.id, { onDelete: "cascade" | "set null" })` mirroring today.
- `daily_usage`: `unique().on(t.user_id, t.date)` (required by the `ON CONFLICT(user_id, date)` upsert).
- CHECK bodies are written as raw unqualified SQL (`sql\`role IN (...)\``, not `${t.role}`) so the normalized text matches legacy inline CHECKs.
- `messages.tool_calls` stays plain `text` for now (`{ mode: "json" }` is a later option).
- `usage_events.operation`: `text({ enum: ["chat"] })` + CHECK `operation = 'chat'`.
- **Bootstrap tip**: apply the current `schema.sql` to a scratch DB, run `drizzle-kit pull` against it, then hand-clean the output (PKs → table-level, CHECKs → unqualified).

### Types

`DbUser` etc. become `typeof users.$inferSelect`. Zod schemas stay as the hand-written API contract (they carry `.uuid()`, `.email()`, OpenAPI examples). A type-level test asserts each Drizzle row type is assignable to its Zod API type, so drift fails typecheck.

The baseline types **cannot** pass that assertion. The nullable DB columns map to non-null API fields. So the type swap happens only after `0003` (§5). We're choosing comprehensive tightening over a DB→API normalization layer. This fixes the data instead of every read path, and `COALESCE`-style normalization would hide real NULLs forever. Full field inventory (DB nullable today → API non-null):

| Table | Columns to make NOT NULL |
|---|---|
| `users` | `id`, `role`, `total_queries`, `created_at` |
| `access_requests` | `id`, `status`, `submitted_at` |
| `chat_sessions` | `id`, `created_at` |
| `messages` | `id`, `created_at`, `input_tokens`, `output_tokens`, `cost_microusd` |
| `usage_events` | `id`, `created_at` |
| `daily_usage` | `query_count`, `created_at`, `input_tokens`, `output_tokens` (no Zod schema, but query results are typed non-null) |
| `rate_limits` | `role`, `updated_at` |

Columns that stay nullable match the API (`name`, `image_url`, `institution`, `research_area`, `last_active_at`, `daily_*_limit*`, `use_case`, `reviewed_*`, `title`, `updated_at` on sessions, `content`, `tool_calls`, `reasoning`, `session_id`, `message_id`). The type test covers all five Zod-backed tables. Each table also gets a reverse "no extra non-null DB column missing from the API" check, so new columns force a decision.

## 5. Migrations

| # | Generated by | Contents | Runs on legacy prod? |
|---|---|---|---|
| `0000_baseline` | `drizzle-kit generate --name baseline` | All 7 tables, indexes, CHECKs, FKs | **No** — adoption rebuilds to it and records it (§6) |
| `0001_tool_search_fts` | `generate --custom` | `CREATE VIRTUAL TABLE IF NOT EXISTS tool_search_fts USING fts5(...)` | Yes (no-op) |
| `0002_seed_and_data_fixes` | `generate --custom` | `INSERT OR IGNORE` rate_limits user/admin; `UPDATE users SET role='user' WHERE role='waitlist'` | Yes (idempotent) |
| `0003_tighten_not_null` | `drizzle-kit generate` after schema edits, then **hand-prepended backfills** | NULL backfills, then drizzle-kit's table recreations with NOT NULL + column-level `.primaryKey()` | Yes |

### `0003` backfills (prepended above the generated recreate statements)

drizzle-kit's recreate copies rows with a plain `INSERT INTO __new_x SELECT … FROM x`. Any remaining NULL in a now-NOT-NULL column aborts the transaction. That's the intended fail-loud behaviour, so every NULL we *can* safely fill is filled first:

| Column(s) | Backfill |
|---|---|
| `users.role` | `'user'` (matches `0002` and the login upgrade in `clerk.ts`; `db:verify` lists affected rows) |
| `users.total_queries`, `messages.{input,output}_tokens`, `messages.cost_microusd`, `daily_usage.{query_count,input,output}_tokens` | `0` (the column default) |
| `*.created_at`, `access_requests.submitted_at`, `rate_limits.updated_at` | `unixepoch()` — unknown original time; `db:verify` reports the count |
| `access_requests.status` | `'pending'` (column default) |
| `id` / `rate_limits.role` NULL PKs | **not** backfilled — such rows can't be referenced; the copy fails and the operator decides. `db:verify` reports them up front |

Hand edits to generated SQL are fine: the snapshot is unaffected, and the drift guard (§10) only checks that `generate` produces nothing new.

### Developer workflow from then on

1. Edit `schema/*.ts`
2. `bun run db:generate --name <change>`
3. Review the SQL (add backfills before any recreate that tightens a column)
4. Commit schema + SQL + snapshot together
5. Next boot applies it

Data/seed changes: `bun run db:generate:custom --name <x>`.

### SQLite foot-gun

For many column changes drizzle-kit generates table recreation (`CREATE __new_x`, copy, `DROP x`, rename). `PRAGMA foreign_keys=OFF` is a no-op inside a transaction, so `DROP TABLE users` would cascade-delete every chat session unless FKs are disabled *before* the transaction starts. With FKs off, nothing enforces integrity during the migration. So [SQLite's procedure](https://sqlite.org/lang_altertable.html#otheralter) requires `PRAGMA foreign_key_check` **before commit**. Drizzle's `migrate()` can't do that: it commits the SQL and `__drizzle_migrations` rows in one go ([dialect.ts](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sqlite-core/dialect.ts#L888-L940)). A post-commit check would only find an orphan after the invalid change and its history row are already durable, and refusing to boot then leaves a committed bad state. §7 therefore runs migrations through our own executor and checks FKs inside the transaction.

## 6. Legacy DB adoption (`legacy.ts`)

Detected when the DB has `users` but no `__drizzle_migrations`. All of steps 2–6 run inside the single migration transaction from §7, so any failure leaves the legacy DB byte-for-byte as it was.

1. **Backup** (outside the transaction): `VACUUM INTO 'data/backups/app-<ts>-pre-drizzle.db'`.
2. **Catch-up**: run the old ALTER list (frozen in `legacy.ts`), this time only ignoring "duplicate column" errors — anything else throws.
3. **Semantic verify (pre-rebuild)**: compare the legacy fingerprint against an in-memory DB migrated to `0000`, using `introspect.ts`. Mismatch → throw, don't boot. The fingerprint is representation-agnostic but semantically complete:
   - **Columns** by name (not `cid` — `ALTER`-added columns sit at the end): declared type, notnull, normalized default.
   - **Primary key** columns, plus `AUTOINCREMENT` presence (parsed from `sqlite_master.sql`). INTEGER rowid-alias PKs are treated as implicitly NOT NULL.
   - **Foreign keys** (`PRAGMA foreign_key_list`): from/to table+column, `on_delete`, `on_update`.
   - **Unique column-sets**, regardless of origin (inline constraint `u` or `CREATE UNIQUE INDEX` `c`).
   - **CHECK constraints**, extracted from `sqlite_master.sql` (column-level and table-level) and normalized. Names, `CONSTRAINT` wrappers, table qualifiers and quotes are stripped; whitespace is collapsed; keywords are case-folded; redundant outer parens are dropped. Compared as a per-table multiset, so a missing or altered `role`/`status`/`operation` check is caught.
   - **Ordinary indexes** (origin `c`, non-unique): name, column list with order (`PRAGMA index_xinfo`), unique flag, partial `WHERE` clause.
4. **Canonical rebuild**: for every one of the 7 tables, apply SQLite's 12-step procedure using the exact DDL from the fresh `0000` DB:
   - `CREATE TABLE __adopt_x` with the `0000` DDL (renamed);
   - `INSERT INTO __adopt_x (cols) SELECT cols FROM x`, with columns listed by name;
   - `DROP TABLE x`, then `ALTER TABLE __adopt_x RENAME TO x`;
   - recreate `x`'s indexes from `0000`.

   Afterwards the adopted DB has the same unique-index representation as a fresh one. Named `users_clerk_id_unique` etc. replace the anonymous `sqlite_autoindex_*`. So a future migration that drops a named unique index really removes uniqueness on both paths. Rebuilding also normalizes column order.
5. **Exact verify (post-rebuild)**: normalized `sqlite_master` (type, name, tbl_name, sql) must equal the fresh `0000` DB exactly. This catches rebuild bugs that the semantic fingerprint would tolerate.
6. **Mark baseline**: create `__drizzle_migrations` and insert `{hash, created_at}` for `0000` (from `readMigrationFiles()`) through the executor's bookkeeping helper, so it matches what the migrator expects.
7. The executor then applies `0001+` in the same transaction (§7); `foreign_key_check` runs before commit.

### Pre-deploy check against a prod copy

The DB runs in WAL mode, so committed pages can still be in `app.db-wal`. Downloading only `app.db` can give a stale or inconsistent copy ([SQLite WAL](https://sqlite.org/wal.html#the_wal_file)). Instead, snapshot on the machine and download the snapshot:

```bash
fly ssh console -C "bun run /app/server/db/cli/snapshot.ts /app/data/backups/prod-copy.db"
fly ssh sftp get /app/data/backups/prod-copy.db ./prod-copy.db
fly ssh console -C "rm /app/data/backups/prod-copy.db"   # remote cleanup; local deletes use gio trash
bun run db:verify ./prod-copy.db
```

`cli/snapshot.ts` is standalone: it opens the path directly with `bun:sqlite` and doesn't import `client.ts`/config, so it doesn't start a second app connection or run migrations. It runs `VACUUM INTO`, which reads one consistent snapshot including WAL content.

`db:verify` copies the input again, then runs the full adoption + migration transaction on the copy. It reports:
- fingerprint diffs;
- per-column `0003` backfill counts and NULL-PK rows;
- NULL-role users by `id`/`email`/`created_at`, so they can be reviewed before deploy. If any of them was meant to stay blocked, fix it by hand before the release;
- FK violations;
- wall-clock time of the transaction (that's how long the write lock is held at first boot).

## 7. Runtime (`migrate.ts` + `executor.ts`, used by `server/index.ts` and `db:migrate`)

```ts
export function runMigrations() {
  const files = readMigrationFiles({ migrationsFolder: join(import.meta.dir, "migrations") });
  const pending = pendingMigrations(sqlite, files);           // same rule as Drizzle, see below
  if ((pending.length > 0 || isLegacy(sqlite)) && isFileDb) backup(`pre-migrate-${ts}`); // VACUUM INTO, keep last N
  if (pending.length === 0 && !isLegacy(sqlite)) return;

  sqlite.run("PRAGMA foreign_keys = OFF");                    // must be outside the transaction
  try {
    sqlite.transaction(() => {
      if (isLegacy(sqlite)) adoptLegacy(sqlite, files[0]);     // §6 steps 2–6
      for (const m of pendingMigrations(sqlite, files)) applyMigration(sqlite, m); // SQL + history row
      const violations = sqlite.query("PRAGMA foreign_key_check").all();
      if (violations.length) throw new MigrationFkError(violations); // → ROLLBACK: data AND history
    })();
  } finally {
    sqlite.run("PRAGMA foreign_keys = ON");
  }
}
```

- **Executor = Drizzle's bookkeeping, our transaction.** `executor.ts` mirrors 0.45.4 `SQLiteSyncDialect.migrate`:
  - same `__drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)` table;
  - "pending" means `folderMillis` > the last row's `created_at`;
  - statements split on `--> statement-breakpoint`;
  - one history row per migration.

  The difference is that the transaction is ours, so `foreign_key_check` runs before `COMMIT`. A violation rolls back both the data changes and the history rows, and the next boot retries from the same clean state.
- Boot refuses to start on `MigrationFkError` (the DB is unchanged; restore isn't needed).
- `server/index.ts:17`: `initializeSchema()` → `runMigrations()` (still before listen).
- Migrations live under `server/db/` → already copied by the Dockerfile's `COPY app/server`. No Dockerfile change.
- No down-migrations in Drizzle: rollback = restore the auto-backup + forward-fix. Document the restore steps in the README.

## 8. Query layer rewrite

Keep every `*Queries` export name and signature so routes/middleware/chat-v2 don't change (except the transaction call). The port lands after `0003`, so `$inferSelect` types are already non-null where the API needs them. No casts, no normalization layer.

| Today | Drizzle |
|---|---|
| `stmt("SELECT * FROM users WHERE id = ?").get(id)` | `db.select().from(users).where(eq(users.id, id)).get() ?? null` (Drizzle returns `undefined`; current contract is `null`) |
| `incrementAndGet`: upsert + separate SELECT | Single statement: `.insert().onConflictDoUpdate({ target: [user_id, date], set: { query_count: sql\`${dailyUsage.query_count} + 1\` } }).returning({ query_count }).get()` |
| `incrementTokens` with `excluded.` | `set: { input_tokens: sql\`${dailyUsage.input_tokens} + excluded.input_tokens\` }` |
| Aggregates `COALESCE(SUM(...))` | `sql<number>\`coalesce(sum(${usageEvents.cost_microusd}), 0)\``, `count()` |
| `unixepoch()` in updates | `sql\`(unixepoch())\`` |
| FTS5 `MATCH`/`rank` | Stays raw: `db.all(sql\`... WHERE tool_search_fts MATCH ${q} ORDER BY rank LIMIT ${n}\`)` |
| `db.transaction(() => {...})()` (`chat-v2.ts:694`) | `db.transaction(() => {...})` — sync, same connection, so the existing global-`db` calls inside stay transactional |

- The `stmtCache` disappears; if a hot path ever shows up in profiling, use Drizzle `.prepare()` with `sql.placeholder()`.
- `scripts/approve-access.ts`: port to `accessRequestQueries.approve` (note: it isn't in the Docker image today — either copy it in or keep it local-only).

## 9. Scripts (`app/package.json`)

```json
"db:generate": "drizzle-kit generate",
"db:generate:custom": "drizzle-kit generate --custom",
"db:migrate": "bun run server/db/cli/migrate.ts",
"db:check": "drizzle-kit check",
"db:verify": "bun run server/db/cli/verify.ts",
"db:snapshot": "bun run server/db/cli/snapshot.ts",
"db:studio": "drizzle-kit studio"
```

Remove `db:init`.

## 10. Tests & CI

- `createTestDb()` helper: in-memory DB + all migrations (requires `paths.ts` to accept `:memory:` — today it would be joined onto the project root).
- **Legacy fixtures**: a frozen copy of today's `schema.sql`, plus an "old prod" variant built from the pre-ALTER schema + the ALTER list (different column order). Both contain inline UNIQUEs and seeded rows.
- **Migration tests — happy path**:
  - a fresh DB migrates cleanly;
  - both legacy fixtures adopt, and their final `sqlite_master` + fingerprint equal the fresh DB's;
  - running migrations twice is a no-op;
  - a recreate-table migration doesn't cascade-delete children;
  - `0003` backfills: fixture rows with NULL `role`/`created_at`/counters come out with the documented values.
- **Migration tests — atomicity**:
  - an FK violation rolls back fully. A test migration inserts an orphan `chat_sessions` row; `runMigrations()` throws `MigrationFkError`; afterwards the orphan is absent, `__drizzle_migrations` has no row for that migration, and `PRAGMA foreign_keys` is back ON;
  - a NULL text PK in a legacy fixture makes `0003` fail. The whole transaction rolls back, including adoption: no `__drizzle_migrations`, original tables and `sqlite_autoindex_*` intact.
- **Migration tests — negative adoption** (each must throw and leave the DB unchanged):
  - missing or altered CHECK (`role` enum without `admin`; no `operation = 'chat'` check);
  - missing ordinary index (`idx_messages_chat_id`) or an index on the wrong columns;
  - wrong column type / nullability, missing FK, wrong `ON DELETE`;
  - missing unique on `users.email`; missing `AUTOINCREMENT` on `daily_usage`.
- **Unique-constraint parity test**: apply a test migration that drops `users_clerk_id_unique` to both a fresh DB and an adopted legacy DB. In both, inserting a duplicate `clerk_id` now succeeds. Before the drop, it fails in both.
- **Executor compatibility test**: after our executor applies all migrations, Drizzle's own `migrate()` against the same DB is a no-op. A DB migrated by Drizzle's `migrate()` reports zero pending in our executor. This guards the exact version pin.
- **Type test**: Drizzle `$inferSelect` ⇄ Zod API types (§4), compiled by `bun run typecheck`.
- **Query tests**: upserts, cost/token totals, rate-limit fallbacks, FTS search.
- **CI additions** (`.github/workflows/test.yml`):
  - `bun run typecheck`
  - `bunx drizzle-kit check`
  - drift guard: `bunx drizzle-kit generate && git diff --exit-code server/db/migrations` — fails any PR that edits the schema without committing a migration.

## 11. Phases (one commit each)

1. **build**: exact-pinned deps, `drizzle.config.ts`, `paths.ts`, `client.ts` (old code still running in parallel).
2. **feat(db)**: baseline schema in code (table-level PKs, unqualified CHECKs), generated `0000`, custom `0001`/`0002`, `introspect.ts`, `executor.ts`, `legacy.ts`, `verify.ts`, `snapshot.ts`, migration tests (happy path, atomicity, negative adoption, unique parity, executor compatibility).
3. **feat(db)**: tightening (mandatory). Schema edits to NOT NULL + column-level `.primaryKey()`, generated `0003` with hand-prepended backfills, backfill + NULL-PK tests.
4. **refactor(db)**: `migrate.ts`, swap `server/index.ts`, split + port the query layer, `$inferSelect` types + type test; trash `schema.sql`/`init.ts`; update README, `docs/architecture.md`, `docs/CODEMAPS/backend.md`.
5. **ci**: drift guard + `drizzle-kit check`.
6. **feat(db)** (optional): drop redundant `idx_users_clerk_id`/`idx_users_email`; drop the waitlist role if no longer needed.
7. **refactor(db)** (follow-up, after prod and every dev DB has `__drizzle_migrations`): trash `legacy.ts` and its fixtures/tests. `runMigrations()` then refuses to boot on a DB that has `users` but no `__drizzle_migrations`, with a message pointing at the last release that still contains adoption.

### Release

1. `db:snapshot` on the machine → `sftp get` → `db:verify ./prod-copy.db` (§6). Review the backfill counts, the NULL-role user list, NULL PKs (must be 0), FK violations (must be 0) and the lock duration.
2. Deploy. The first boot backs up, then in one transaction adopts and rebuilds the legacy DB, applies `0001`–`0003`, checks FKs, and commits. Then it serves.
3. Confirm the `__drizzle_migrations` rows (4) and that `users_clerk_id_unique`/`users_email_unique` exist, via `fly ssh`. The only `sqlite_autoindex_*` left are the ones backing text PKs, which fresh DBs have too.
