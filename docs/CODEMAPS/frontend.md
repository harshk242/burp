# Frontend Codemap

**Generated:** 2026-03-13 | **Files:** 45 | **Lines:** 2,985 | **Framework:** Next.js 14 (App Router) + Tailwind + Zustand

## Entry Points

- `app/web/app/layout.tsx` — Root layout (ClerkProvider, global styles)
- `app/web/app/page.tsx` (219) — Landing/home page
- `app/web/app/(protected)/layout.tsx` (142) — Authenticated layout (Sidebar + Header)

## Architecture

```
app/web/
├── app/                           # Next.js App Router
│   ├── layout.tsx                 #   Root layout + ClerkProvider
│   ├── page.tsx                   #   Landing page
│   ├── globals.css                #   Tailwind base styles
│   ├── (auth)/                    #   Public auth pages
│   │   ├── sign-in/page.tsx       #     Clerk sign-in
│   │   └── sign-up/page.tsx       #     Clerk sign-up
│   ├── (protected)/               #   Auth-required routes
│   │   ├── layout.tsx             #     Sidebar + Header wrapper
│   │   ├── chat/[[...sessionId]]/ #     Main chat interface
│   │   │   ├── page.tsx           #       Server component (session routing)
│   │   │   └── client.tsx         #       Client component (chat logic)
│   │   └── tools/page.tsx         #     Tool browser
│   └── request-access/page.tsx    #   Waitlist signup
├── components/
│   ├── chat/                      # Chat-specific components
│   │   ├── ChatContainer.tsx      #   Chat layout wrapper
│   │   ├── MessageList.tsx        #   Conversation history
│   │   ├── MessageBubble.tsx      #   Individual message (markdown + copy)
│   │   ├── MessageInput.tsx       #   Auto-resize textarea
│   │   ├── ToolCallCard.tsx       #   Tool execution display
│   │   └── StreamingText.tsx      #   Real-time markdown rendering
│   ├── layout/
│   │   ├── Sidebar.tsx            #   Session list, new chat, deletion
│   │   └── Header.tsx             #   Branding + user menu
│   ├── shared/
│   │   ├── EmptyState.tsx         #   No-content placeholder
│   │   └── LoadingSpinner.tsx     #   Loading indicator
│   ├── tools/
│   │   ├── DatabaseGroup.tsx      #   Tools grouped by database
│   │   └── ToolCard.tsx           #   Individual tool display
│   ├── ui/                        #   Radix UI primitives (badge, button, card, etc.)
│   └── ClerkWrapper.tsx           #   Clerk provider init
├── stores/                        # Zustand state management
│   ├── chatStore.ts               #   Messages, streaming content, tool calls
│   ├── sessionStore.ts            #   Session list, active session ID
│   ├── toolStore.ts               #   Available tools, filters
│   └── uiStore.ts                 #   Sidebar visibility, theme
├── hooks/
│   └── useApi.ts                  #   Fetch wrapper with auth headers
├── lib/
│   ├── sse.ts                     #   SSE streaming client (event → store dispatch)
│   ├── chatUrl.ts                 #   URL routing for session IDs
│   ├── constants.ts               #   API URL, model names
│   ├── id.ts                      #   UUID generation
│   └── utils.ts                   #   cn() class merging, formatters
└── types/
    └── index.ts                   #   Shared TypeScript interfaces
```

## Key Modules

| File | Lines | Role |
|------|-------|------|
| `components/layout/Sidebar.tsx` | 222 | Session list with tooltips, new chat, delete |
| `app/page.tsx` | 219 | Landing page with feature highlights |
| `app/(protected)/chat/.../client.tsx` | 189 | Chat page client: wires stores + SSE stream |
| `app/request-access/page.tsx` | 185 | Waitlist form with institution/use-case fields |
| `lib/sse.ts` | 184 | Parses SSE events, dispatches to Zustand stores |
| `app/(protected)/tools/page.tsx` | 160 | Tool browser with search and database grouping |
| `app/(protected)/layout.tsx` | 142 | Protected shell: sidebar + header + auth guard |
| `types/index.ts` | 113 | Shared types: Message, Session, Tool, ToolCall |
| `components/chat/ToolCallCard.tsx` | 110 | Expandable tool call card (input/output/status) |
| `components/chat/MessageBubble.tsx` | 104 | Message rendering: markdown, copy, typing dot |
| `stores/chatStore.ts` | 97 | Active conversation state machine |

## Data Flow

```
User types message → MessageInput → chatStore.sendMessage()
  → lib/sse.ts → POST /api/chat (SSE connection)
  → event: text → chatStore.appendStreamingText()
  → event: tool_start → chatStore.addToolCall(pending)
  → event: tool_end → chatStore.updateToolCall(complete)
  → event: done → chatStore.finalizeMessage()
  → event: title → sessionStore.updateTitle()

Sidebar → sessionStore.loadSessions() → GET /api/sessions
       → sessionStore.setActive(id) → router.push(/chat/[id])
       → GET /api/sessions/:id/messages → chatStore.setMessages()
```

## State Shape (Zustand)

```
chatStore:    { messages[], streamingText, toolCalls[], isStreaming, error }
sessionStore: { sessions[], activeSessionId, isLoading }
toolStore:    { tools[], searchQuery, selectedDatabase }
uiStore:      { sidebarOpen, theme }
```

## Related Areas

- [INDEX](./INDEX.md) — Full overview
- [Backend](./backend.md) — API endpoints consumed by frontend
- [Database](./database.md) — Data model backing sessions/messages
