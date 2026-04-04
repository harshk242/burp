# Plan: PDF Export & Collapsible Reasoning Toggle

## Context
The BURP chat app shows AI responses with reasoning/planning text (e.g., "I'll search for BRCA1...") mixed inline with the final response. The model generates text in an agentic loop — text before tool calls is reasoning, text after all tool calls is the response — but currently ALL text is stored in a single `content` column and streamed as identical `text` SSE events. Two improvements are needed:
1. Allow downloading individual assistant messages as PDF (per-message action bar button)
2. Separate reasoning text from final response under a collapsible toggle — visible during streaming, auto-collapsed when complete

---

## Feature 1: Per-Message PDF Download

### Approach
Use `html2pdf.js` (client-side, wraps html2canvas + jsPDF). It captures the rendered DOM faithfully — markdown, code blocks, GFM tables all preserved. The download button sits in each assistant message's action bar (next to the existing copy button). Session title = PDF filename.

**PDF capture scope**: The ref wraps the full assistant message container (tool call summary + response content). Reasoning blocks are excluded via the `onclone` callback which hides `.reasoning-block` elements. Expanded tool call details are also hidden — only the collapsed summary header is kept.

### Steps

#### 1a. Install dependency
```bash
cd app/web && bun add html2pdf.js
```

#### 1b. Create type declaration
**Create** `/app/web/types/html2pdf.d.ts`
- Declare module with `html2pdf()` factory, `.from()`, `.set()`, `.save()` methods

#### 1c. Create PDF export utility
**Create** `/app/web/lib/exportPdf.ts`
- Export `exportMessageAsPdf(element: HTMLElement, title: string): Promise<void>`
- Sanitize title for filename (strip illegal chars, fallback to "chat-export")
- Config: A4, 10mm margins, JPEG quality 0.98, scale 2
- `onclone` callback:
  - Hide `.reasoning-block` elements (reasoning excluded from PDF)
  - Hide action bars (copy/download buttons)
  - Hide expanded tool call card details (keep summary header only)
  - Force light background for print-friendly output
- Wrap in try/catch — return a `{ success: boolean; error?: string }` result so the caller can show feedback

#### 1d. Add download button to MessageBubble
**Modify** `/app/web/components/chat/MessageBubble.tsx`
- Add a `ref` on the outer assistant message content container (`flex-1 space-y-2` div that wraps tool calls + message content)
- Import `Download`, `Loader2` icons from lucide-react
- Add `<DownloadButton>` next to existing `<CopyButton>` in the action bar (assistant messages only)
- `DownloadButton` internal state: `isExporting` (boolean)
- On click: set `isExporting=true`, call `exportMessageAsPdf(ref.current, sessionTitle)`, handle result (log error to console), set `isExporting=false`
- Disabled state: when `isExporting` is true or ref is null
- Show `<Loader2 className="animate-spin" />` while exporting, `<Download />` otherwise
- Accept `sessionTitle` prop on `MessageBubble`

#### 1e. Pass session title down
**Modify** `/app/web/components/chat/MessageList.tsx`
- Add `sessionTitle: string` prop, pass to each `MessageBubble`

**Modify** `/app/web/app/(protected)/chat/[[...sessionId]]/client.tsx`
- Read active session title from `useSessionStore`: find session by `currentSessionId`, use `session.title ?? "Chat"`
- Pass `sessionTitle` to `MessageList`

### Files
| File | Action |
|------|--------|
| `app/web/types/html2pdf.d.ts` | Create |
| `app/web/lib/exportPdf.ts` | Create |
| `app/web/components/chat/MessageBubble.tsx` | Modify — add ref, DownloadButton, accept sessionTitle prop |
| `app/web/components/chat/MessageList.tsx` | Modify — pass sessionTitle prop through |
| `app/web/app/(protected)/chat/[[...sessionId]]/client.tsx` | Modify — read session title, pass to MessageList |

---

## Feature 2: Collapsible Reasoning Toggle

### Approach: Separate DB column + `text_block_end` SSE event (Option B)

**Why not HTML comment markers?** Storing `<!-- reasoning-start -->` markers in the `content` column would leak into model context — `buildMessages()` (line 233) feeds `msg.content` directly into future LLM turns. A separate `reasoning` column is clean, avoids model contamination, and requires no fragile regex parsing on the client.

**Server**: Store reasoning and response as separate DB columns. Add a `text_block_end` SSE event after each iteration's text stream completes, carrying `{ isReasoning: boolean }` based on `finishReason`. Text is streamed as `text` events in real-time (no latency penalty). The `text_block_end` signal tells the client to reclassify accumulated text.

**Client (streaming)**: Text streams visibly in real-time. When `text_block_end` with `isReasoning: true` arrives, move accumulated `streamingContent` into `reasoningSegments` and render it inside a `ReasoningBlock` that auto-collapses. Final response text continues streaming normally.

**Client (finalized)**: Load `reasoning` directly from the DB field (no parsing). Render in a collapsed `ReasoningBlock`.

### Steps

#### 2a. DB migration — add `reasoning` column
**Modify** `/app/server/db/index.ts`
- Add to `applyMigrations()`:
  ```typescript
  "ALTER TABLE messages ADD COLUMN reasoning TEXT",
  ```

**Modify** `/app/server/db/schema.sql`
- Add `reasoning TEXT` to the `messages` CREATE TABLE (for fresh installs)

#### 2b. Update `messageQueries.create()` to accept reasoning
**Modify** `/app/server/db/index.ts`
- Add `reasoning` parameter to `messageQueries.create()` (default `null`)
- Update INSERT statement to include the `reasoning` column

#### 2c. Update server Zod schema
**Modify** `/app/server/schemas/index.ts`
- Add `reasoning: z.string().nullable().default(null)` to `MessageSchema2`

(No route changes needed — `GET /sessions/:id` does `SELECT *` and `...msg` spread, so `reasoning` flows through automatically)

#### 2d. Server: Separate reasoning from response + emit `text_block_end`
**Modify** `/app/server/orchestration/chat-v2.ts`

Add `"text_block_end"` to the `StreamEvent` type union.

Add a `reasoningText` accumulator alongside `persistedAssistantText`:
```typescript
let reasoningText = "";          // accumulates pre-tool reasoning text
let persistedAssistantText = ""; // accumulates final response text only
```

After text streaming and `finishReason` resolution (after line 395), yield the signal:
```typescript
if (fullAssistantContent) {
  yield { type: "text_block_end", data: { isReasoning: finishReason === "tool-calls" } };
}
```

In the non-final iteration branch (where `finishReason === "tool-calls"`):
```typescript
// Accumulate into reasoning, NOT persistedAssistantText
if (fullAssistantContent) {
  reasoningText += (reasoningText ? "\n\n" : "") + fullAssistantContent;
}
```

In the final iteration branch:
```typescript
// This is the actual response
if (fullAssistantContent) {
  persistedAssistantText = fullAssistantContent;
}
```

Update `messageQueries.create()` call to pass `reasoningText`:
```typescript
messageQueries.create(
  assistantMsgId, sessionId, "assistant",
  persistedAssistantText,     // content = final response only
  allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : null,
  totalInputTokens, totalOutputTokens,
  reasoningText || null        // reasoning = pre-tool text (null if none)
);
```

**No change to `buildMessages()`** — it reads `msg.content` which now contains only response text. Reasoning never enters model context.

#### 2e. Update frontend types
**Modify** `/app/web/types/index.ts`
- Add `"text_block_end"` to `SSEEventType` union
- Add `reasoning?: string` to `Message` interface
- Add `reasoning?: string | null` to `DbMessage` interface

#### 2f. Update chat store
**Modify** `/app/web/stores/chatStore.ts`

Add state:
```typescript
reasoningSegments: string[];  // completed reasoning text blocks during streaming
```

Add action:
```typescript
moveStreamingToReasoning: () => void;
// Implementation: push streamingContent → reasoningSegments, reset streamingContent to ""
```

Update `finalizeAssistantMessage()`:
- `content` = current `streamingContent` (final response only)
- `reasoning` = `reasoningSegments.join("\n\n")` (if non-empty, else undefined)
- Reset `reasoningSegments` to `[]`

Update `resetStreamingState()` and `reset()` to clear `reasoningSegments: []`.

#### 2g. Handle SSE event
**Modify** `/app/web/lib/sse.ts`

Add case:
```typescript
case "text_block_end": {
  const { isReasoning } = data as { isReasoning: boolean };
  if (isReasoning) {
    store.moveStreamingToReasoning();
  }
  break;
}
```

#### 2h. Create ReasoningBlock component
**Create** `/app/web/components/chat/ReasoningBlock.tsx`

Follow `ToolCallGroup.tsx` pattern (file: `app/web/components/chat/ToolCallGroup.tsx`):
- Props: `{ content: string; defaultExpanded?: boolean }`
- State: `expanded` (default = `defaultExpanded ?? false`)
- Root element: `<div className="reasoning-block ...">` (class used by PDF exclusion)
- Header button: `ChevronDown`/`ChevronRight` + `Brain` icon (from lucide-react) + "Reasoning" label
- Expanded: render content via `ReactMarkdown` + `remarkGfm` inside a styled container with muted background (pinkish/purple tint to match reference screenshot)
- Visual style: border, rounded corners, consistent with ToolCallGroup

#### 2i. Update MessageBubble for finalized messages
**Modify** `/app/web/components/chat/MessageBubble.tsx`

For assistant messages with `message.reasoning`:
- Render `<ReasoningBlock content={message.reasoning} />` before the tool calls section
- Rendering order: ReasoningBlock → ToolCallGroup → Message content

#### 2j. Update MessageList for streaming
**Modify** `/app/web/components/chat/MessageList.tsx`

Add `reasoningSegments: string[]` to props (from chat store).

During streaming, layout becomes:
1. `ReasoningBlock` (for completed `reasoningSegments.join("\n\n")`, collapsed, visible only if non-empty)
2. `ToolCallGroup` (pending tool calls)
3. `StreamingText` (current `streamingContent` — streams visibly, could be first-iteration reasoning or final response)

When `text_block_end { isReasoning: true }` fires, `streamingContent` moves to `reasoningSegments` → `StreamingText` resets → text "collapses" into the `ReasoningBlock`.

#### 2k. Load reasoning from historical messages
**Modify** `/app/web/app/(protected)/chat/[[...sessionId]]/client.tsx`

In `loadMessages()`, when converting `DbMessage` → `Message`:
```typescript
reasoning: msg.reasoning || undefined,  // DB field, no parsing needed
```

Pass `reasoningSegments` from `useChatStore` to `MessageList`.

**Backward compatibility**: Pre-existing messages have `reasoning = NULL` in the DB. `msg.reasoning || undefined` handles this — no reasoning block rendered for old messages. Their content remains in `content` as before.

### Files
| File | Action |
|------|--------|
| `app/server/db/schema.sql` | Modify — add `reasoning TEXT` to CREATE TABLE |
| `app/server/db/index.ts` | Modify — add migration + update `messageQueries.create()` |
| `app/server/schemas/index.ts` | Modify — add `reasoning` to `MessageSchema2` |
| `app/server/orchestration/chat-v2.ts` | Modify — separate reasoning accumulation + `text_block_end` event |
| `app/web/types/index.ts` | Modify — add types |
| `app/web/stores/chatStore.ts` | Modify — reasoning state + actions |
| `app/web/lib/sse.ts` | Modify — handle `text_block_end` |
| `app/web/components/chat/ReasoningBlock.tsx` | Create — collapsible reasoning component |
| `app/web/components/chat/MessageBubble.tsx` | Modify — render ReasoningBlock |
| `app/web/components/chat/MessageList.tsx` | Modify — streaming reasoning segments |
| `app/web/app/(protected)/chat/[[...sessionId]]/client.tsx` | Modify — load reasoning from DB field, pass to MessageList |

---

## Implementation Order
1. **Feature 2 first** — changes Message type, DB schema, and content structure
2. **Feature 1 second** — PDF export builds on top, needs to know about reasoning blocks to exclude them

---

## Verification

### Feature 2 (Reasoning)
1. Start the app: `cd app/web && bun dev` + `cd app/server && bun dev`
2. Send a query that triggers tool calls (e.g., "What proteins interact with BRCA1?")
3. During streaming: verify text appears openly, then collapses into "Reasoning" toggle when `text_block_end` arrives
4. After completion: verify reasoning is in a collapsed toggle, final response displays normally
5. Reload the page: verify historical messages load reasoning from the `reasoning` DB column correctly
6. Test edge case: send a simple question with no tool calls — verify no reasoning block appears (reasoning is null)
7. Test backward compat: existing messages (pre-migration, `reasoning = NULL`) render as before — no reasoning block, content intact

### Feature 1 (PDF)
1. On a completed assistant message, hover to reveal action bar
2. Click the download button — verify spinner shows during export
3. Verify PDF downloads with session title as filename
4. Verify PDF contains: tool call summary header + response markdown (tables, code blocks, lists render correctly)
5. Verify PDF does NOT contain: reasoning block, action bar buttons, expanded tool call details
6. Test error case: verify graceful handling if export fails (no crash, button re-enables)
7. Test with a message that has no reasoning — verify clean PDF output
