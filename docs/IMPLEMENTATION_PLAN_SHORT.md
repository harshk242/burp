# Super Bio Agent - Implementation Plan (Short)

## Overview

**What we're building:** A conversational AI agent that lets researchers query 10 biomedical databases using natural language, cross-reference results automatically, and get synthesized answers with citations.

**Problem it solves:** Biomedical researchers currently waste hours manually searching UniProt, then ChEMBL, then ClinVar, etc. and stitching results together. Super Bio Agent automates this cross-platform research workflow.

**Target audience:**
- Academic researchers (genomics, drug discovery, cancer biology)
- Pharma/biotech scientists
- Bioinformaticians
- Clinical geneticists

**Integrated platforms (10):**

| Platform | Data Type |
|----------|-----------|
| UniProt | Protein sequences & annotations |
| ChEMBL | Bioactive molecules & drugs |
| PubChem | Chemical compounds |
| Ensembl | Genomic data & variants |
| ClinVar | Clinical variant interpretations |
| Open Targets | Drug-target associations |
| Reactome | Biological pathways |
| ClinicalTrials.gov | Clinical trial data |
| PubMed | Biomedical literature |
| ClinPGx | Pharmacogenomics |

---

## Architecture

```
Vercel (Next.js)  ──▶  Convex (Backend)  ──▶  Railway (Gateway + MCP Servers)
     │                      │                         │
 • Chat UI              • Auth                    • 10 MCP Servers
 • Landing page         • User management         • Tool registry
 • Tool browser         • Chat history            • LLM orchestration
                        • Waitlist                • SSE streaming
```

## Project Structure

```
super-bio-agent/
├── apps/web/              # Next.js frontend (Vercel)
│   ├── app/               # Pages (chat, landing, request-access)
│   ├── components/        # UI components
│   └── convex/            # Convex schema + functions
├── packages/gateway/      # Bun HTTP server (Railway)
│   └── src/
│       ├── mcp/           # Server manager + tool registry
│       ├── orchestration/ # Chat loop with Claude
│       └── routes/        # HTTP endpoints
└── mcp-servers/           # Existing 10 MCP servers
```

## Phases

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **1. Setup** | Day 1 | Bun monorepo, Next.js app, Gateway package |
| **2. Convex** | Day 2-3 | Schema, auth, waitlist, chat sync |
| **3. Gateway** | Day 3-5 | MCP manager, tool search, chat orchestration |
| **4. Frontend** | Day 5-7 | Chat UI, tool trace, request access page |
| **5. Deploy** | Day 7-8 | Dockerfile, Railway, Vercel, Convex prod |
| **6. Launch** | Day 9-10 | Smoke tests, docs, invite researchers |

## Convex Schema (4 tables)

- **users**: email, role (user/admin/waitlist), usage stats
- **accessRequests**: email, institution, researchArea, status (pending/approved/rejected)
- **chats**: userId, title, timestamps
- **messages**: chatId, role, content, toolCalls[]

## Gateway Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check + tool stats |
| `GET /tools` | List all 214 tools |
| `GET /tools/search?q=` | Fuzzy search tools |
| `POST /tools/:server/:name` | Direct tool invocation |
| `POST /chat` | Chat with SSE streaming |

## Deployment

| Service | Platform | Cost |
|---------|----------|------|
| Frontend | Vercel | Free |
| Backend + Auth | Convex | Free |
| Gateway | Railway | $5-20/mo |
| Domain | Cloudflare | $10/yr |

## Environment Variables

```bash
# Gateway (Railway)
ANTHROPIC_API_KEY=sk-ant-...
NCBI_API_KEY=...

# Web (Vercel)
NEXT_PUBLIC_CONVEX_URL=https://...convex.cloud
CONVEX_DEPLOY_KEY=...
GATEWAY_URL=https://...railway.app
```

## User Flow

1. **Landing** → User visits site
2. **Request Access** → Fills form (name, institution, research area, use case)
3. **Waitlist** → Admin reviews and approves
4. **Sign Up** → Convex Auth (email/password or OAuth), role upgraded to "user"
5. **Chat** → Full access to 10 platforms via natural language

## Key Tech Decisions

- **Bun** for package management and gateway runtime
- **Convex** for backend + auth + real-time sync (all-in-one)
- **Hono** for gateway HTTP (lightweight, fast)
- **SSE** for streaming (simpler than WebSocket for this use case)
- **Single container** for gateway + MCP servers (simpler ops for MVP)
