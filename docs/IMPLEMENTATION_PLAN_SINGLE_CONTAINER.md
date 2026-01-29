# Super Bio Agent - Single Container Implementation Plan

## Overview

**What:** A conversational AI agent for querying 10 biomedical databases using natural language.

**Problem:** Researchers waste hours manually searching multiple databases and stitching results together.

**Audience:** Academic researchers, pharma scientists, bioinformaticians, clinical geneticists.

**Platforms (10):**
| Platform | Data |
|----------|------|
| UniProt | Proteins |
| ChEMBL | Drugs/molecules |
| PubChem | Chemicals |
| Ensembl | Genomics |
| ClinVar | Clinical variants |
| Open Targets | Drug-targets |
| Reactome | Pathways |
| ClinicalTrials | Trials |
| PubMed | Literature |
| ClinPGx | Pharmacogenomics |

---

## Architecture

```
                    ┌─────────────┐
                    │    Clerk    │  (Auth SaaS)
                    │  • Login    │
                    │  • Signup   │
                    │  • Sessions │
                    └──────┬──────┘
                           │
┌──────────────────────────┼──────────────────────────┐
│              SINGLE DOCKER CONTAINER                │
│                           │                         │
│  ┌────────────────────────▼────────────────────┐   │
│  │           Bun Server (Hono)                  │   │
│  │                                              │   │
│  │  /              → Static UI (built Next.js)  │   │
│  │  /api/chat      → Chat + SSE streaming       │   │
│  │  /api/tools     → Tool registry + search     │   │
│  │  /api/waitlist  → Access requests            │   │
│  │  /api/sessions     → Chat history               │   │
│  └──────────────────────┬───────────────────────┘   │
│                         │                           │
│  ┌──────────────────────▼───────────────────────┐   │
│  │           MCP Manager (child processes)       │   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │   │
│  │  │UniPr│ │ChEMB│ │PubCh│ │Ensem│ │ClinV│    │   │
│  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘    │   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐    │   │
│  │  │OpenT│ │React│ │Trial│ │PubMe│ │ClinP│    │   │
│  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘    │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │           SQLite (data/app.db)                │   │
│  │  • users, chat_sessions, messages, waitlist           │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## Project Structure

```
super-bio-agent/
├── app/
│   ├── server/
│   │   ├── index.ts          # Entry point (serves static + API)
│   │   ├── routes/
│   │   │   ├── users.ts      # User sync + profile
│   │   │   ├── chat.ts       # Chat + SSE
│   │   │   ├── chat_sessions.ts      # Chat history CRUD
│   │   │   ├── tools.ts      # Tool registry
│   │   │   └── waitlist.ts   # Access requests
│   │   ├── middleware/
│   │   │   └── clerk.ts      # Clerk JWT verification (Hono)
│   │   ├── mcp/
│   │   │   ├── manager.ts    # Process lifecycle
│   │   │   └── registry.ts   # Tool search
│   │   ├── db/
│   │   │   ├── schema.sql    # SQLite schema
│   │   │   └── index.ts      # DB connection + queries
│   │   └── orchestration/
│   │       └── chat.ts       # LLM tool-calling loop
│   ├── web/                  # Next.js (static export)
│   │   ├── app/
│   │   │   ├── sign-in/      # Clerk sign-in component
│   │   │   ├── sign-up/      # Clerk sign-up component
│   │   │   ├── chat/         # Chat interface (client-side protected)
│   │   │   ├── tools/        # Tool browser
│   │   │   ├── request-access/
│   │   │   └── page.tsx      # Landing page
│   │   ├── components/
│   │   ├── lib/
│   │   │   └── api.ts        # API client (adds Clerk token to requests)
│   │   ├── next.config.js    # output: 'export'
│   │   └── package.json
│   └── package.json
├── mcp-servers/              # Existing 10 servers
├── data/                     # SQLite (volume mount)
├── Dockerfile
└── docker-compose.yml
```

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Bun | Fast, built-in SQLite, TS native |
| HTTP | Hono | Lightweight, SSE support |
| DB | SQLite (via bun:sqlite) | Zero setup, single file |
| Auth | Clerk (client-side) | Handles OAuth, email, sessions |
| UI | Next.js (static export) | Just HTML/CSS/JS, no server needed |
| LLM | Claude API | Best tool-calling |

---

## Auth Flow (Client-Side Clerk + Hono JWT)

```
┌─────────────────────────────────────────────────────────────────┐
│                        AUTH FLOW                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User visits /chat                                           │
│         │                                                        │
│         ▼                                                        │
│  2. React checks: useAuth().isSignedIn                          │
│         │                                                        │
│         ├── No  → Redirect to /sign-in (client-side)            │
│         │              │                                         │
│         │              ▼                                         │
│         │         Clerk UI handles login                        │
│         │              │                                         │
│         │              ▼                                         │
│         │         Redirect back to /chat                        │
│         │                                                        │
│         ▼                                                        │
│  3. User is signed in → Clerk stores JWT in cookie              │
│         │                                                        │
│         ▼                                                        │
│  4. UI calls API: fetch('/api/chat', {                          │
│         headers: { Authorization: `Bearer ${await getToken()}` } │
│     })                                                           │
│         │                                                        │
│         ▼                                                        │
│  5. Hono middleware verifies JWT with Clerk                     │
│         │                                                        │
│         ├── Invalid → 401 Unauthorized                          │
│         │                                                        │
│         ▼                                                        │
│  6. Check user role in SQLite                                   │
│         │                                                        │
│         ├── Role = "waitlist" → 403 Access Pending              │
│         │                                                        │
│         ▼                                                        │
│  7. Process request                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key code snippets:**

```tsx
// web/app/chat/page.tsx - Client-side protection
"use client";
import { useAuth, RedirectToSignIn } from "@clerk/nextjs";

export default function ChatPage() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <Loading />;
  if (!isSignedIn) return <RedirectToSignIn />;

  return <ChatInterface />;
}
```

```ts
// web/lib/api.ts - API client with token
import { useAuth } from "@clerk/nextjs";

export function useApi() {
  const { getToken } = useAuth();

  return async (path: string, options?: RequestInit) => {
    const token = await getToken();
    return fetch(`/api${path}`, {
      ...options,
      headers: {
        ...options?.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  };
}
```

```ts
// server/middleware/clerk.ts - Hono JWT verification
import { createClerkClient } from "@clerk/backend";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Cache user info to avoid repeated API calls
const userCache = new Map<string, { email: string; expiresAt: number }>();

export async function clerkAuth(c, next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const payload = await clerk.verifyToken(token);
    const clerkUserId = payload.sub;

    // NOTE: Clerk JWT doesn't include email by default.
    // Fetch user info from Clerk API using the sub (user ID).
    let email: string;
    const cached = userCache.get(clerkUserId);

    if (cached && cached.expiresAt > Date.now()) {
      email = cached.email;
    } else {
      const user = await clerk.users.getUser(clerkUserId);
      email = user.emailAddresses[0]?.emailAddress;
      if (!email) {
        return c.json({ error: "User has no email" }, 401);
      }
      // Cache for 5 minutes
      userCache.set(clerkUserId, { email, expiresAt: Date.now() + 5 * 60 * 1000 });
    }

    c.set("clerkUserId", clerkUserId);
    c.set("email", email);
    await next();
  } catch (err) {
    return c.json({ error: "Invalid token" }, 401);
  }
}
```

**Alternative: Configure Clerk JWT template (faster, no API call)**

In Clerk Dashboard → JWT Templates → Create template:
```json
{
  "email": "{{user.primary_email_address}}"
}
```
Then `payload.email` will be available directly.

---

## Database Schema (SQLite)

```sql
-- IMPORTANT: Enable foreign key enforcement (must run on each connection)
PRAGMA foreign_keys = ON;

-- Users (synced from Clerk)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  image_url TEXT,
  role TEXT DEFAULT 'waitlist', -- waitlist | user | admin
  institution TEXT,
  research_area TEXT,
  total_queries INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  last_active_at INTEGER
);

-- Access requests (waitlist)
CREATE TABLE access_requests (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  institution TEXT,
  research_area TEXT,
  use_case TEXT,
  status TEXT DEFAULT 'pending', -- pending | approved | rejected
  submitted_at INTEGER DEFAULT (unixepoch()),
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Chats
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER
);

-- Messages (cascade delete when chat is deleted)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- user | assistant
  content TEXT,
  tool_calls TEXT, -- JSON array
  created_at INTEGER DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX idx_users_clerk_id ON users(clerk_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_access_requests_email ON access_requests(email);
CREATE INDEX idx_access_requests_status ON access_requests(status);
```

**Database connection (enable foreign keys on every connection):**

```ts
// server/db/index.ts
import { Database } from "bun:sqlite";

const db = new Database(process.env.DATABASE_URL || "./data/app.db");

// IMPORTANT: Enable foreign key enforcement
db.run("PRAGMA foreign_keys = ON");

export { db };
```

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | - | Serve static UI |
| `/api/users/sync` | POST | Clerk | Sync user from Clerk after login |
| `/api/users/me` | GET | Clerk | Current user info + role |
| `/api/waitlist` | POST | - | Submit access request (public) |
| `/api/waitlist` | GET | Admin | List pending requests |
| `/api/waitlist/:id/approve` | POST | Admin | Approve request |
| `/api/tools` | GET | User | List all tools |
| `/api/tools/search` | GET | User | Search tools |
| `/api/tools/:server/:name` | POST | User | Direct tool call |
| `/api/sessions` | GET | User | List user's chat_sessions |
| `/api/sessions` | POST | User | Create new chat |
| `/api/sessions/:id` | GET | User | Get chat with messages |
| `/api/chat` | POST | User | Chat with SSE streaming |
| `/health` | GET | - | Health check |

**Auth levels:**
- `-` = Public
- `Clerk` = Valid Clerk session required
- `User` = Clerk session + role is "user" or "admin"
- `Admin` = Clerk session + role is "admin"

---

## Phases

| Phase | Days | Deliverables |
|-------|------|--------------|
| **1. Setup** | 1 | Bun server, SQLite schema, project structure |
| **2. Auth** | 1 | Clerk client-side setup, Hono JWT middleware, user sync |
| **3. Gateway** | 2-3 | MCP manager, tool registry, chat orchestration |
| **4. UI** | 2-3 | Next.js static export, chat interface, tool browser |
| **5. Container** | 1 | Dockerfile, docker-compose, local testing |
| **6. Deploy** | 1 | Railway/Fly.io, domain, smoke tests |

**Total: ~7-9 days**

### Phase breakdown:

**Phase 2 (Auth) details:**
- Create Clerk account, get API keys
- Add `@clerk/nextjs` to web app
- Add `@clerk/backend` to server
- Implement Hono middleware for JWT verification
- Create `/api/users/sync` endpoint
- Add role checking middleware

---

## Dockerfile

```dockerfile
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# Build MCP servers
FROM base AS mcp-build
COPY mcp-servers ./servers/
RUN for dir in servers/*/; do cd "$dir" && bun install && bun run build && cd ../..; done

# Build web UI (static export)
FROM base AS web-build

# IMPORTANT: NEXT_PUBLIC_* vars must be available at build time
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY app/web ./web
RUN cd web && bun install && bun run build
# Output is in ./web/out (static HTML/CSS/JS)

# Build server
FROM base AS server-build
COPY app/server ./server
COPY app/package.json ./
RUN bun install

# Final image
FROM base AS runner

# Copy MCP servers
COPY --from=mcp-build /app/servers ./servers

# Copy web static files (served by Hono)
COPY --from=web-build /app/web/out ./public

# Copy server
COPY --from=server-build /app/server ./server
COPY --from=server-build /app/node_modules ./node_modules

# Create data directory
RUN mkdir -p /app/data

ENV PORT=3000
ENV DATABASE_URL=/app/data/app.db
EXPOSE 3000

VOLUME ["/app/data"]

CMD ["bun", "run", "server/index.ts"]
```

**Next.js config for static export:**

```js
// app/web/next.config.js
/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  // Static files go to ./out directory
  trailingSlash: true,
  images: { unoptimized: true },
};
```

**Hono serves static files (IMPORTANT: order matters!):**

```ts
// server/index.ts
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const app = new Hono();

// IMPORTANT: Register API routes FIRST (Hono matches in order)
app.route("/api", apiRoutes);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Static files LAST (catch-all for Next.js pages)
app.use("*", serveStatic({ root: "./public" }));

// Fallback to index.html for client-side routing
app.use("*", serveStatic({ root: "./public", path: "index.html" }));
```

---

## docker-compose.yml

```yaml
version: "3.8"
services:
  app:
    build:
      context: .
      args:
        # NEXT_PUBLIC_* vars needed at BUILD time for static export
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-}
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      # Runtime env vars (server-side only)
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - NCBI_API_KEY=${NCBI_API_KEY}
      - CLERK_SECRET_KEY=${CLERK_SECRET_KEY}
      - ADMIN_EMAIL=${ADMIN_EMAIL}
    restart: unless-stopped
```

---

## Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Optional
NCBI_API_KEY=...              # For PubMed/ClinVar (higher rate limits)
ADMIN_EMAIL=admin@example.com # First user with this email becomes admin
PORT=3000
DATABASE_URL=/app/data/app.db
```

---

## Deployment Options

| Platform | Cost | Notes |
|----------|------|-------|
| **Railway** | $5-20/mo | Easiest, persistent volume |
| **Fly.io** | $5-15/mo | Good global latency |
| **Render** | $7-25/mo | Simple, auto-deploy |
| **VPS (Hetzner)** | €4-10/mo | Cheapest, full control |

All support Docker + persistent volumes for SQLite.

---

## User Flow

```
1. Visit site → Landing page
2. Click "Request Access" → Fill form (name, institution, use case)
3. Admin approves → User's email added to approved list
4. User clicks "Sign In" → Clerk handles OAuth/email login
5. On first login → User synced to SQLite, role set based on approval status
6. If approved → Access chat interface
7. If not approved → Shown "pending approval" message
8. Chat → Query across 10 platforms
```

---

## Key Simplifications

| Before (3 services) | After (1 container + Clerk) |
|---------------------|---------------------|
| Vercel (UI) | Static files served by Hono |
| Convex (Auth + DB) | Clerk (auth) + SQLite (data) |
| Railway (Gateway) | Same Bun server |
| 3 deployments | 1 `docker run` command |

**Why Clerk (client-side):**
- Handles OAuth (Google, GitHub), email/password, MFA
- No server-side middleware needed (works with static export)
- JWT verification on API routes only
- Free tier: 10,000 MAU
- ~1 hour to integrate

**Why static export:**
- Just HTML/CSS/JS files
- Served directly by Hono (no Node.js server for Next.js)
- Faster cold starts, less memory
- Clerk works client-side with `@clerk/nextjs`

**Tradeoffs:**
- No SSR (fine for this app - it's a SPA)
- Client-side redirects (slightly slower than middleware)
- External dependency for auth (but Clerk is reliable)
- Manual backup of SQLite (use volume + cron)
