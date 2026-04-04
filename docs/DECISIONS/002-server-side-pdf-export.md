# 002 — Server-Side PDF Export (Deferred)

**Date:** 2026-04-04  
**Status:** Deferred  
**Context:** PDF export implementation for BURP chat assistant responses

---

## Decision

We chose **client-side pdfmake** (Option 3) for the current PDF export implementation
instead of a server-side Puppeteer/Playwright approach (Option 4).

## Options Considered

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| 1 | `window.print()` | Zero deps | Print dialog; no direct download |
| 2 | `html2canvas` + jsPDF | Rich fidelity | Rasterises text; not selectable |
| 3 ✅ | pdfmake + mdast walker | Direct download; text-selectable; no server needed | Requires AST conversion; limited CSS fidelity |
| 4 | Server-side Puppeteer/Playwright | Pixel-perfect HTML render; full CSS | Needs server endpoint; adds infra complexity; slower |

## Why Option 4 is Deferred (Not Rejected)

Option 4 (server-side headless-browser PDF) would produce higher-fidelity output
by rendering the actual React component HTML, including all Tailwind/prose CSS.
It is deferred because:

1. **Infrastructure overhead** — requires a persistent server-side endpoint with
   a headless Chromium binary, adding cold-start latency and deployment complexity.
2. **Scope** — the current need (text-selectable, nicely structured PDFs) is
   fully satisfied by the pdfmake approach at zero server cost.
3. **Content nature** — BURP responses are structured markdown reports; the mdast
   → pdfmake walker captures all meaningful semantics without pixel-perfect CSS.

## Future Trigger

Revisit Option 4 if any of the following arise:
- Customer demand for PDF output that mirrors the exact visual styling of the chat UI.
- Complex chart/image content that cannot be represented in pdfmake.
- A server-side rendering infrastructure is already in place for other features.

## Implementation Notes (Option 3)

- `app/web/lib/pdf/mdastToPdfmake.ts` — pure AST walker, fully unit-tested
- `app/web/lib/pdf/generatePdf.ts` — orchestrator; pdfmake loaded via dynamic import
  to keep it out of the main bundle
- `app/web/lib/exportPdf.ts` — thin public adapter; signature `(content: string, title: string)`
- pdfmake v0.3.7 with Roboto (via `vfs_fonts` side-effect) and Courier (AFM) fonts
