# Rate Limits Per User + Token Budget + UI Transparency

## Context
BURP already has query-count rate limiting (50 queries/day per role), a `UsageIndicator`
header component, and token capture in `chat-v2.ts` via Vercel AI SDK (`result.usage`) —
but tokens are **only logged, never stored or surfaced**. The goal is:

1. **Per-user rate limit overrides** — admin can set individual user query + token quotas via admin UI
2. **Token budget enforcement** — hard daily token limit (429 block) in addition to query count
3. **Token transparency** — store per-message and daily token aggregates; show in chat UI

**Confirmed design choices:**
- Token limits: enforced as 429 (not display-only)
  - ⚠️ **Enforcement semantics**: Query count = strict (atomic upsert). Token budget = best-effort
    (tokens are unknown until the response completes, so a request can overshoot by ≤1 request).
    The *next* request is blocked once the budget is exceeded. This is standard industry behaviour
    and is clearly documented in code comments.
- Per-user limits: managed via admin UI  
- Token display in messages: hover/subtle (same pattern as existing copy button)

---

## What Already Exists (Do Not Duplicate)

| What | Where |
|------|-------|
| Query rate limit middleware | `app/server/middleware/rateLimit.ts` |
| `daily_usage` table (`query_count`) | `app/server/db/schema.sql` |
| `rate_limits` table (per-role defaults) | `app/server/db/schema.sql` |
| Token extraction from Vercel AI SDK | `app/server/orchestration/chat-v2.ts` L392-405 |
| `UsageIndicator` component | `app/web/components/layout/UsageIndicator.tsx` |
| `useUsage` hook + `/api/usage` route | `app/web/hooks/useUsage.ts`, `app/server/routes/usage.ts` |
| `userStore` with usage state | `app/web/stores/userStore.ts` |
| SSE pipeline (7 event types) | `app/server/routes/chat.ts` → `app/web/lib/sse.ts` |
| `chatStore` + messages | `app/web/stores/chatStore.ts` |
| Admin panel (access requests) | `app/web/app/(protected)/admin/client.tsx` |
| Waitlist/user list route | `app/server/routes/waitlist.ts` |

---

## Step 1 — Schema + Config Changes

### `app/server/db/schema.sql`
Add columns (all with safe defaults so existing rows are unaffected):
```sql
-- Per-user limit overrides (NULL = use role default)
ALTER TABLE users ADD COLUMN daily_query_limit INTEGER;   -- NULL = role default
ALTER TABLE users ADD COLUMN daily_token_limit INTEGER;   -- NULL = config default

-- Token aggregate on daily_usage
ALTER TABLE daily_usage ADD COLUMN input_tokens INTEGER DEFAULT 0;
ALTER TABLE daily_usage ADD COLUMN output_tokens INTEGER DEFAULT 0;

-- Token counts per assistant message
ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT 0;
```
For new installs `CREATE TABLE IF NOT EXISTS` handles it. For live DBs these `ALTER TABLE`
statements need to run once at startup (add migration helper or run manually).

### `app/server/config.ts` — Add `rate_limits` section to `AppConfigSchema`
```typescript
rate_limits: z.object({
  default_daily_tokens: z.number().int().default(200_000), // 200k tokens/day for users
}).default({}),
```

### `app/config.yaml`
```yaml
rate_limits:
  default_daily_tokens: 200000
```

---

## Step 2 — Database Queries (`app/server/db/index.ts`)

### `userQueries` additions
```typescript
updateLimits(id: string, dailyQueryLimit: number | null, dailyTokenLimit: number | null)
listAll(): DbUser[]   // for admin panel users tab
```

### `dailyUsageQueries` changes
- `incrementAndGet(userId)` → stays the same (query count only)
- Add `incrementTokens(userId, inputTokens, outputTokens)` — upsert adds to token columns
- `getToday(userId)` → extended to `getTodayFull(userId)` returning
  `{ query_count, input_tokens, output_tokens }`

### `messageQueries.create()` signature change
Add optional `inputTokens?: number, outputTokens?: number` params.

---

## Step 3 — Rate Limit Middleware (`app/server/middleware/rateLimit.ts`)

Replace single `dailyLimit` lookup with two sequential checks:

```typescript
const dbUser = c.get("dbUser")!;

// 1. Query count — STRICT enforcement (atomic upsert = no race window)
//    Priority: user override > role-based default
const queryLimit = dbUser.daily_query_limit ?? rateLimitQueries.getForRole(role);
const todayFull = dailyUsageQueries.getTodayFull(userId);

if (queryLimit !== -1 && todayFull.query_count >= queryLimit) {
  return 429 with { error: "query_limit_exceeded", limit: queryLimit, ... }
}

// 2. Token budget — BEST-EFFORT enforcement
//    Tokens are unknown until the response completes, so we check
//    accumulated tokens from *prior* requests. A single request can
//    overshoot by at most its own token count before the next request
//    is blocked. This is standard behaviour for streaming APIs.
//    Priority: user override > config default; admin = always -1.
const tokenLimit = dbUser.daily_token_limit ??
  (role === "admin" ? -1 : appConfig.rate_limits.default_daily_tokens);
// Comment in code: token enforcement is best-effort (checked pre-request,
// incremented post-response). Up to ~1 request of overshoot is possible.
const todayTokens = todayFull.input_tokens + todayFull.output_tokens;

if (tokenLimit !== -1 && todayTokens >= tokenLimit) {
  return 429 with { error: "token_limit_exceeded", token_limit: tokenLimit, tokens_used: todayTokens, ... }
}

// Increment query count atomically before processing
dailyUsageQueries.incrementAndGet(userId);
// Token increment happens inside processChat after completion (see Step 4)
```

Update response headers to include token info:
- `X-RateLimit-Token-Limit`
- `X-RateLimit-Token-Remaining`
- `X-RateLimit-Token-Used`

Update frontend `RateLimitError` type and 429 handler in `sse.ts` to handle both error types.

---

## Step 4 — Chat Orchestration (`app/server/orchestration/chat-v2.ts`)

**Persistence ownership stays inside `processChat`** — it already calls `messageQueries.create()`
at line 663. Do not split ownership to the route.

Accumulate tokens across all tool-call iterations (currently reset each loop):
```typescript
let totalInputTokens = 0;
let totalOutputTokens = 0;

// Inside the loop, after: const usage = await result.usage;
totalInputTokens += usage?.inputTokens ?? 0;
totalOutputTokens += usage?.outputTokens ?? 0;
```

Existing `messageQueries.create()` call (line 663) gains two new args:
```typescript
messageQueries.create(
  assistantMsgId, sessionId, "assistant",
  persistedAssistantText,
  allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : null,
  totalInputTokens,    // ← new
  totalOutputTokens    // ← new
);
```

Also call daily token increment inside `processChat` (same place `incrementQueries` already runs):
```typescript
dailyUsageQueries.incrementTokens(userId, totalInputTokens, totalOutputTokens);
```

Then yield `done` first, then `usage` **after** `done`:
```typescript
yield { type: "done", data: { messageId: assistantMsgId } };
// usage comes AFTER done so the frontend's finalizeAssistantMessage() has
// already committed the message to state.messages before setLastMessageTokens runs
yield { type: "usage", data: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } };
```

---

## Step 5 — Chat Route (`app/server/routes/chat.ts`)

No persistence changes needed here — that's fully owned by `processChat` (see Step 4).

The route's `for await` loop already forwards every yielded event including the new `usage` and
the reordered `done` → `usage` sequence. No code change required for event forwarding.

---

## Step 6 — Usage API (`app/server/routes/usage.ts`)

Extend `/api/usage` response:
```typescript
{
  used,             // query count today
  limit,            // effective query limit (user override or role default)
  remaining,
  resetAt,
  total_queries,
  role,
  tokens: {
    used_today,     // input + output tokens today
    limit,          // effective token limit (-1 = unlimited)
    remaining,      // -1 if unlimited
    input_today,
    output_today
  }
}
```

Update `UsageSchema` in `app/server/schemas/index.ts` (actual path — not `schemas.ts`).

---

## Step 7 — Admin API (`app/server/routes/admin.ts` — new file, ~100 LOC)

New routes mounted at `/api/admin` (require admin role):
- `GET /users` — list all users with their current limits + today's usage
- `PATCH /users/:id/limits` — set `daily_query_limit` and/or `daily_token_limit` for a user
  - Accepts `null` to clear override and revert to defaults

Register in `app/server/routes/index.ts`.

---

## Step 8 — Frontend Type Updates (`app/web/types/index.ts`)

```typescript
// Extend Message
interface Message {
  // ...existing
  tokenUsage?: { input: number; output: number }
}

// Extend UsageInfo
interface UsageInfo {
  // ...existing
  tokens: {
    used_today: number;
    limit: number;       // -1 = unlimited
    remaining: number;
    input_today: number;
    output_today: number;
  }
}
```

---

## Step 9 — Chat Store (`app/web/stores/chatStore.ts`)

Add action:
```typescript
setLastMessageTokens(input: number, output: number)
// Safe to call only AFTER finalizeAssistantMessage — scans state.messages
// (not streamingContent) for the last assistant message and patches tokenUsage.
// Because `usage` SSE arrives after `done` (which triggers finalizeAssistantMessage),
// the target message is guaranteed to be in state.messages by the time this runs.
```

---

## Step 10 — SSE Handler (`app/web/lib/sse.ts`)

Add `usage` event case. This arrives **after** `done`; `finalizeAssistantMessage()` has
already been called (triggered by `done`), so the last assistant message is in `state.messages`:
```typescript
case "usage": {
  const { inputTokens, outputTokens } = data as { inputTokens: number; outputTokens: number };
  store.setLastMessageTokens(inputTokens, outputTokens);
  break;
}
```

Update 429 error parsing to handle both `query_limit_exceeded` and `token_limit_exceeded`
error codes and surface a clear message for each.

---

## Step 11 — MessageBubble Token Display (`app/web/components/chat/MessageBubble.tsx`)

Add hover-revealed token count below assistant messages (same `group-hover` pattern as copy button):
```tsx
{/* Token count — shown on hover like copy button */}
{!isUser && message.tokenUsage && (
  <span className="text-[10px] text-muted-foreground/50 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
    {(message.tokenUsage.input + message.tokenUsage.output).toLocaleString()} tokens
    &nbsp;·&nbsp;↑{message.tokenUsage.input.toLocaleString()} ↓{message.tokenUsage.output.toLocaleString()}
  </span>
)}
```

---

## Step 12 — UsageIndicator Update (`app/web/components/layout/UsageIndicator.tsx`)

Show dual progress bars (queries + tokens) or a combined tooltip:
- Primary display: `X / Y queries` (unchanged)
- Tooltip adds token line: `~12.4k / 200k tokens used today`
- Color threshold: fire yellow/red based on whichever limit is closer to exhausted
- For token limit `-1` (admin/unlimited): skip token bar entirely

---

## Step 13 — Admin UI (`app/web/app/(protected)/admin/client.tsx`)

Add a **"Users" tab** next to the existing "Access Requests" tab:
- Table: name, email, role, total queries, today's usage, current limits
- Inline edit per row: "Query limit" and "Token limit" input fields (blank = default)
- Save button calls `PATCH /api/admin/users/:id/limits`
- Use existing Radix UI table, dialog, badge components (no new deps)

---

## Critical Files Summary

| File | Change type |
|------|-------------|
| `app/server/db/schema.sql` | Add token + limit columns |
| `app/server/db/index.ts` | New queries for tokens, user limits, user list |
| `app/server/middleware/rateLimit.ts` | Dual check: query + token limits, per-user overrides |
| `app/server/orchestration/chat-v2.ts` | Accumulate token totals, yield `usage` SSE event |
| `app/server/routes/chat.ts` | No change needed — existing `for await` loop forwards all events including new `usage` |
| `app/server/routes/usage.ts` | Return token fields |
| `app/server/routes/admin.ts` | **New** — list users + PATCH limits (admin-only) |
| `app/server/routes/index.ts` | Mount new admin routes |
| `app/server/schemas/index.ts` | Update UsageSchema (correct path) |
| `app/server/config.ts` | Add `rate_limits.default_daily_tokens` |
| `app/config.yaml` | `rate_limits.default_daily_tokens: 200000` |
| `app/web/types/index.ts` | Extend Message + UsageInfo |
| `app/web/lib/sse.ts` | Handle `usage` event |
| `app/web/stores/chatStore.ts` | `setLastMessageTokens` action |
| `app/web/components/chat/MessageBubble.tsx` | Hover token count display |
| `app/web/components/layout/UsageIndicator.tsx` | Token quota display in tooltip |
| `app/web/hooks/useUsage.ts` | Forward token data to userStore; update local `UsageResponse` type |
| `app/web/app/(protected)/admin/client.tsx` | "Users" tab with per-user limit editing |

---

## Verification Steps

1. **Token storage**: After a chat, run `SELECT id, input_tokens, output_tokens FROM messages WHERE role='assistant' ORDER BY created_at DESC LIMIT 1` — should have non-zero values.
2. **Daily token aggregate**: `SELECT * FROM daily_usage ORDER BY created_at DESC LIMIT 1` — should have `input_tokens` + `output_tokens`.
3. **SSE order**: Open Network tab → chat request → SSE events → confirm `event: done` arrives **before** `event: usage` (they should appear in that exact order in the stream).
4. **Usage API**: `GET /api/usage` response should include `tokens.used_today`, `tokens.limit`, etc.
5. **Token display in chat**: Hover over an assistant message → token count should appear.
6. **UsageIndicator tooltip**: Should show query count AND token usage line.
7. **Query limit enforcement**: Set `daily_query_limit = 2` for a test user in admin UI → 3rd query returns 429 with `error: "query_limit_exceeded"`.
8. **Token limit enforcement**: Set `daily_token_limit = 500` for test user → after ~500 tokens used, request returns 429 with `token_limit_exceeded`. Verify it's the *next* request that's blocked (current request completes).
9. **Admin UI**: Navigate to `/admin` → Users tab → verify you can set/clear per-user limits.
10. **Admin bypass**: Admin role should remain unlimited for both query and token limits.
11. **Migration idempotency**: On an existing DB, `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (or the startup migration helper) must be safe to run multiple times without error. Verify by restarting the server twice against the same DB.
12. **Concurrent token overshoot**: Fire 2 simultaneous requests when token budget has ~100 tokens remaining. Both should complete (overshoot is allowed for current requests). The *third* request (after both complete) should be blocked with 429.
