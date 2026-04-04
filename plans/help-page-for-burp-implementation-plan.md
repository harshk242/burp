# Help Page for BURP - Implementation Plan

## Context

BURP (Bio Unified Research Platform) is a conversational AI app that lets bio researchers query 10 biomedical databases (UniProt, ChEMBL, PubChem, Ensembl, ClinVar, Open Targets, Reactome, ClinicalTrials, PubMed, ClinPGx) with 210+ tools via natural language chat. Researchers currently lack guidance on how to effectively steer the AI assistant to get accurate, cross-database results. This help page will serve as a comprehensive user guide — teaching researchers the app's capabilities, how to write effective prompts, and how the databases connect.

---

## Route & File Structure

```
app/web/app/help/
  page.tsx                            # Public route at /help (not behind auth)

app/web/components/help/
  helpData.ts                         # All static data constants (databases, prompts, workflows, tips)
  HelpHero.tsx                        # Hero banner with title + quick-link badges
  HelpTableOfContents.tsx             # Sticky sidebar TOC with scroll-spy (desktop only)
  DatabaseOverviewTable.tsx           # Interactive table of all 10 databases
  PromptGuide.tsx                     # Tabbed prompt guidance (anatomy, good vs bad, templates)
  PromptComparison.tsx                # Side-by-side good vs bad prompt cards
  PromptTemplates.tsx                 # Copy-pastable prompt templates grid
  WorkflowSection.tsx                 # Container for 7 research workflow cards
  WorkflowCard.tsx                    # Individual workflow with flow diagram
  DatabaseConnectionMap.tsx           # SVG/CSS diagram showing 10 databases + connections
  IdMappingReference.tsx              # ID mapping cheat-sheet table
  TipsSection.tsx                     # Grid of tip cards with icons
  LimitationsSection.tsx              # Alert-style limitation notices
  CopyButton.tsx                      # Reusable copy-to-clipboard button
  CollapsibleSection.tsx              # Native <details>/<summary> wrapper
  FlowDiagram.tsx                     # Reusable database pipeline diagram (horizontal/vertical)
```

**Total: 1 page + 16 component/data files, each under ~250 LOC (well within the 500 LOC limit)**

---

## Page Sections & Visual Treatments

### Section 1: Hero (`HelpHero.tsx`)
- Back-to-home link with `ArrowLeft` icon
- Title: "Help & User Guide" + subtitle
- Row of quick-link `Badge` components scrolling to each section
- Same gradient background pattern as landing page hero

### Section 2: Database Overview (`DatabaseOverviewTable.tsx`)
Visual: **Responsive table** (desktop) / **stacked cards** (mobile)

| Database | Focus Area | Records | Tools | Key Identifier | Example Query |
|----------|-----------|---------|-------|----------------|---------------|
| Ensembl | Genomic sequences & gene annotations | 200+ species | 25 | ENSG ID (ENSG00000141510) | "What are the transcripts for TP53?" |
| UniProt | Protein sequences & annotations | 27M+ proteins | 26 | Accession (P04637) | "What domains does TP53 protein have?" |
| ChEMBL | Drug compounds & bioactivity | 2M+ compounds | 27 | ChEMBL ID (CHEMBL25) | "Find kinase inhibitors for EGFR" |
| PubChem | Chemical structures & properties | 110M+ compounds | 24 | CID (2244) | "What is the toxicity of aspirin?" |
| ClinVar | Clinical variant interpretation | 1.2M+ variants | 12 | rsID (rs1042522) | "Is rs1042522 pathogenic?" |
| Open Targets | Target-disease-drug associations | 45+ sources | 45+ | EFO ID + ENSG ID | "What diseases are linked to BRCA1?" |
| Reactome | Biological pathways | 2,500+ pathways | 8 | Pathway ID | "What pathways involve TP53?" |
| ClinicalTrials | Clinical trial registrations | 400K+ trials | 18 | NCT ID | "Find recruiting trials for breast cancer" |
| PubMed | Biomedical literature | 35M+ citations | 13 | PMID | "Find recent CRISPR papers for DMD" |
| ClinPGx | Pharmacogenomics | Gene-drug pairs | 16 | Star allele (CYP2D6*1) | "CYP2D6 poor metabolizer dosing for codeine?" |

- Each row has a color-coded left border matching the database color
- Database name shown with a lucide icon and colored `Badge`
- Tool count shown as a small pill

### Section 3: Writing Effective Prompts (`PromptGuide.tsx`) *(KEY SECTION)*
Visual: **Tabbed interface** using shadcn `Tabs`

**Tab 1 - "Prompt Anatomy"**: Color-coded annotated prompt showing:
```
┌─ Context (blue) ──────────────────────────────────────────┐
│ "For the TP53 gene,                                       │
├─ Specificity (green) ────────────────────────────────────-┤
│  look up ClinVar pathogenic variants and                  │
│  Ensembl variant consequences,                            │
├─ Cross-reference (purple) ───────────────────────────────-┤
│  then find Open Targets disease associations              │
│  for the same gene.                                       │
├─ Output format (amber) ──────────────────────────────────-┤
│  Present results as a summary table with identifiers."    │
└───────────────────────────────────────────────────────────-┘
```
Each section highlighted with a colored left border + background tint.

**Tab 2 - "Good vs Bad"** (`PromptComparison.tsx`): Side-by-side cards

| Vague (red card with XCircle) | Specific (green card with CheckCircle) |
|-------------------------------|---------------------------------------|
| "Tell me about BRCA1" | "What pathogenic ClinVar variants exist in BRCA1, and which Reactome pathways does the BRCA1 protein participate in?" |
| "Find drugs for cancer" | "What ChEMBL compounds target EGFR with IC50 < 100nM, and which are in active clinical trials for NSCLC?" |
| "What does rs1042522 do?" | "Look up rs1042522 in ClinVar for clinical significance, then check Ensembl for variant consequences on TP53 transcripts" |
| "Analyze this protein" | "For UniProt P04637 (TP53), show protein domains, post-translational modifications, and known interaction partners" |
| "Any trials for Alzheimer's?" | "Find phase 3 clinical trials recruiting in the US for Alzheimer's disease with amyloid-targeting interventions" |

**Tab 3 - "Templates"** (`PromptTemplates.tsx`): Grid of 6 copy-pastable cards

1. **Gene Deep Dive** (Ensembl + UniProt + ClinVar + Reactome + Open Targets)
2. **Drug Safety Profile** (ChEMBL + PubChem + Open Targets + ClinicalTrials)
3. **Variant Interpretation** (ClinVar + Ensembl + UniProt + Open Targets + PubMed)
4. **Target Druggability** (Open Targets + ChEMBL + UniProt + ClinicalTrials)
5. **Pharmacogenomic Check** (ClinPGx + ClinVar + ChEMBL + PubMed)
6. **Literature Review** (PubMed + Open Targets + ClinicalTrials)

Each card: title + database `Badge` tags + template text in monospace `<pre>` + `CopyButton`

**Tab 4 - "Steering Tips"**: Numbered list of advanced techniques:
- Naming databases explicitly ("Use ClinVar to check..." rather than "check the variant")
- Providing identifiers when known ("for ENSG00000141510" rather than "for the TP53 gene")
- Requesting cross-references ("then map to UniProt and find Reactome pathways")
- Controlling scope ("only phase 3 trials", "approved drugs only", "human orthologs only")
- Asking for structured output ("present as a table", "list the top 10 by score")

### Section 4: Research Workflows (`WorkflowSection.tsx` + `WorkflowCard.tsx`)
Visual: **Expandable cards** with flow diagrams

7 workflows from `docs/USE_CASES.md`:

1. **VUS-to-Therapy Interpretation** (Clinical geneticist)
2. **Disease-to-Target Prioritization** (Drug discovery scientist)
3. **Pathway-Driven Drug Repurposing** (Repurposing scientist)
4. **Pharmacogenomic Dosing** (Clinical pharmacologist)
5. **Off-Target Safety Assessment** (Safety pharmacologist)
6. **Biomarker-Driven Trial Matching** (Oncologist)
7. **Investment Evidence Package** (Portfolio strategist)

Each `WorkflowCard`:
- Header: workflow name + persona `Badge` + database count
- Collapsed by default using `CollapsibleSection`
- Expanded content:
  - **Flow diagram** (`FlowDiagram.tsx`): horizontal chain of database nodes connected by arrows
    ```
    [ClinVar] → [Ensembl] → [UniProt] → [Reactome] → [Open Targets] → [ChEMBL] → [ClinicalTrials] → [PubMed]
       ↓            ↓            ↓           ↓              ↓               ↓              ↓              ↓
    Map variant  Consequences  Protein fn  Pathways    Disease assoc   Compounds      Trials      Literature
    ```
    - Each node: colored pill with database abbreviation
    - Arrows: CSS borders + `ChevronRight` icons
    - Mobile: vertical orientation with `ChevronDown`
  - **Example prompt**: styled blockquote with `CopyButton`
  - **Why valuable**: 1-sentence summary

### Section 5: Database Connection Map (`DatabaseConnectionMap.tsx`)
Visual: **Interactive SVG diagram** (desktop) / **simplified list** (mobile)

```
                    ┌──────────┐
                    │  PubMed  │
                    └────┬─────┘
                         │
    ┌─────────┐    ┌─────┴──────┐    ┌──────────┐
    │ PubChem │────│   ChEMBL   │────│  ClinPGx │
    └────┬────┘    └──────┬─────┘    └──────────┘
         │                │
    ┌────┴────┐    ┌──────┴──────┐
    │ ClinVar │────│ Open Targets│────┐
    └────┬────┘    └──────┬──────┘    │
         │                │           │
    ┌────┴────┐    ┌──────┴─────┐  ┌──┴───────────┐
    │ Ensembl │────│  UniProt   │  │ClinicalTrials│
    └─────────┘    └──────┬─────┘  └──────────────┘
                          │
                   ┌──────┴─────┐
                   │  Reactome  │
                   └────────────┘
```

Implementation:
- 10 database nodes positioned in a `relative` container using absolute positioning
- SVG `<line>` elements for connections (solid = bidirectional, dashed = unidirectional)
- 4 hub nodes (Open Targets, UniProt, Ensembl, ChEMBL) drawn larger/bolder
- **Hover interaction**: highlight a node's connections + show mapping details in a tooltip
- React `useState` for selected node (no external deps)
- Summary stats below: "16 bidirectional + 8 unidirectional = 40+ connection paths"

Mobile fallback: Each database as a `Card` listing its connections as `Badge` links.

### Section 6: ID Mapping Reference (`IdMappingReference.tsx`)
Visual: **Styled reference table** grouped by mapping type

| Mapping | Starting With | Tool | Example |
|---------|--------------|------|---------|
| **Gene → Ensembl** | Gene symbol (BRCA1) | `ensembl__search_genes("BRCA1")` | Returns ENSG00000012048 |
| **Gene → Protein** | Gene symbol (TP53) | `uniprot__search_by_gene("TP53")` | Returns P04637 |
| **Drug → ChEMBL** | Drug name (imatinib) | `chembl__search_compounds("imatinib")` | Returns CHEMBL941 |
| **Variant → Gene** | rsID (rs1042522) | `clinvar__lookup_by_rsid("rs1042522")` | Returns TP53 + clinical sig |
| **Structure → CID** | SMILES string | `pubchem__search_by_smiles(...)` | Returns PubChem CID |
| **UniProt ↔ Ensembl** | Either direction | `get_external_references` / `get_xrefs` | Cross-refs |

- Tool names in `<code>` with monospace font
- Grouped with row-spanning colored headers
- Pro tip callout: "Always resolve IDs first before cross-referencing databases"

### Section 7: Tips & Best Practices (`TipsSection.tsx`)
Visual: **3-column card grid** (same pattern as landing page features)

6 tip cards with lucide icons:
1. `Target` - "Name the Database" — specify which database to use
2. `Key` - "Provide Known IDs" — give identifiers when you have them
3. `GitBranch` - "Request Cross-References" — ask to link across databases
4. `LayoutList` - "Specify Output Format" — request tables, ranked lists, summaries
5. `MessageSquarePlus` - "Iterate & Drill Down" — start broad, follow up for depth
6. `Layers` - "Combine Databases" — ask for multi-database integrated answers

### Section 8: Limitations (`LimitationsSection.tsx`)
Visual: **Alert-style cards** using shadcn `Alert`

5 items:
1. **Daily Quotas** (`Info`) — Query + token limits per day, resets at midnight UTC
2. **Response Time** (`Clock`) — Complex multi-DB queries may take 30-60s
3. **Live Data** (`RefreshCw`) — Hits live APIs; data reflects current database state
4. **No Bulk Export** (`AlertTriangle`) — Designed for targeted queries, not mass downloads
5. **Large Results** (`FileBox`) — Very large results stored as inspectable artifacts

---

## Page Layout Architecture

```
<main>
  ┌─ HelpHero (full-width banner) ─────────────────────────┐
  │  Back link | Title | Quick-link badges                  │
  └─────────────────────────────────────────────────────────┘

  ┌─ Container (max-w-6xl) ─────────────────────────────────┐
  │  ┌─ Sidebar (desktop) ──┐  ┌─ Content ────────────────┐ │
  │  │  Sticky TOC           │  │                          │ │
  │  │  ├ Overview           │  │  #overview               │ │
  │  │  ├ Databases          │  │  DatabaseOverviewTable   │ │
  │  │  ├ Writing Prompts    │  │                          │ │
  │  │  ├ Workflows          │  │  #prompts                │ │
  │  │  ├ Connections        │  │  PromptGuide (Tabs)      │ │
  │  │  ├ ID Mapping         │  │                          │ │
  │  │  ├ Tips               │  │  #workflows              │ │
  │  │  └ Limitations        │  │  WorkflowSection         │ │
  │  │                       │  │                          │ │
  │  │  (hidden on mobile)   │  │  #connections            │ │
  │  │                       │  │  DatabaseConnectionMap   │ │
  │  │                       │  │                          │ │
  │  │                       │  │  #id-mapping             │ │
  │  │                       │  │  IdMappingReference      │ │
  │  │                       │  │                          │ │
  │  │                       │  │  #tips                   │ │
  │  │                       │  │  TipsSection             │ │
  │  │                       │  │                          │ │
  │  │                       │  │  #limitations            │ │
  │  │                       │  │  LimitationsSection      │ │
  │  └───────────────────────┘  └──────────────────────────┘ │
  └──────────────────────────────────────────────────────────┘

  ┌─ Footer ────────────────────────────────────────────────┐
  │  Same as landing page footer                            │
  └─────────────────────────────────────────────────────────┘
</main>
```

Desktop: `grid grid-cols-[220px_1fr] gap-8` with sticky TOC on left
Mobile: Single column, TOC hidden

---

## Navigation Integration

### Files to modify:
1. **`app/web/components/layout/Header.tsx`** — Add `HelpCircle` icon link to nav:
   ```tsx
   <Button variant="ghost" size="sm" asChild>
     <Link href="/help" className="flex items-center gap-2">
       <HelpCircle className="h-4 w-4" />
       <span className="hidden sm:inline">Help</span>
     </Link>
   </Button>
   ```
   Add after the Tools link (before `UsageIndicator`).

2. **`app/web/app/page.tsx`** — Add "Help" link in footer section.

---

## Critical Files to Modify/Create

| Action | File | Purpose |
|--------|------|---------|
| **Create** | `app/web/app/help/page.tsx` | Help page route |
| **Create** | `app/web/components/help/helpData.ts` | All static data constants |
| **Create** | `app/web/components/help/HelpHero.tsx` | Hero section |
| **Create** | `app/web/components/help/HelpTableOfContents.tsx` | Sticky scroll-spy TOC |
| **Create** | `app/web/components/help/DatabaseOverviewTable.tsx` | Database table/cards |
| **Create** | `app/web/components/help/PromptGuide.tsx` | Tabbed prompt section |
| **Create** | `app/web/components/help/PromptComparison.tsx` | Good vs bad prompts |
| **Create** | `app/web/components/help/PromptTemplates.tsx` | Copy-pastable templates |
| **Create** | `app/web/components/help/WorkflowSection.tsx` | Workflow container |
| **Create** | `app/web/components/help/WorkflowCard.tsx` | Individual workflow card |
| **Create** | `app/web/components/help/DatabaseConnectionMap.tsx` | SVG connection diagram |
| **Create** | `app/web/components/help/IdMappingReference.tsx` | ID mapping cheat-sheet |
| **Create** | `app/web/components/help/TipsSection.tsx` | Tips card grid |
| **Create** | `app/web/components/help/LimitationsSection.tsx` | Limitations alerts |
| **Create** | `app/web/components/help/CopyButton.tsx` | Copy-to-clipboard utility |
| **Create** | `app/web/components/help/CollapsibleSection.tsx` | details/summary wrapper |
| **Create** | `app/web/components/help/FlowDiagram.tsx` | Database pipeline diagram |
| **Modify** | `app/web/components/layout/Header.tsx` | Add Help link to nav |
| **Modify** | `app/web/app/page.tsx` | Add Help link to footer |

## Existing Files to Reuse

| File | What to Reuse |
|------|---------------|
| `app/web/lib/constants.ts` | `DATABASE_LABELS`, `DATABASE_DESCRIPTIONS`, `DATABASE_ORDER` |
| `app/web/components/ui/*` | Card, Table, Tabs, Badge, Alert, Button, Separator, Tooltip, ScrollArea |
| `app/web/app/page.tsx` | Layout patterns (hero, card grid, footer) |
| `docs/USE_CASES.md` | 7 research workflow use cases (content source) |
| `docs/PLATFORM_OVERVIEW_AND_CONNECTIONS.md` | Database connections + ID mapping (content source) |

---

## Dependencies

**No new packages required.** Built entirely with:
- Existing shadcn/ui components
- `lucide-react` icons
- `tailwindcss` + `@tailwindcss/typography`
- Inline SVG for the connection diagram
- Native HTML `<details>`/`<summary>` for collapsibles
- `navigator.clipboard` API for copy buttons

---

## Implementation Sequence

1. **Foundation**: `helpData.ts` → `page.tsx` skeleton → `HelpHero.tsx` → `HelpTableOfContents.tsx` → `CopyButton.tsx` → `CollapsibleSection.tsx`
2. **Content sections**: `DatabaseOverviewTable.tsx` → `PromptGuide.tsx` + `PromptComparison.tsx` + `PromptTemplates.tsx` → `TipsSection.tsx` → `LimitationsSection.tsx` → `IdMappingReference.tsx`
3. **Visual components**: `FlowDiagram.tsx` → `WorkflowSection.tsx` + `WorkflowCard.tsx` → `DatabaseConnectionMap.tsx`
4. **Integration**: Modify `Header.tsx` + `page.tsx` (landing) → Test responsive behavior → Verify `bun run build` succeeds

---

## Verification

1. `bun run build` in `app/web/` — static export must succeed (no server-side data fetching)
2. Open `/help` in browser — verify all sections render
3. Test responsive: resize to mobile width — verify cards stack, SVG hidden, table becomes cards
4. Test TOC scroll-spy on desktop — active section should highlight
5. Test copy buttons — clipboard should receive template text
6. Test collapsible workflows — expand/collapse should work smoothly
7. Verify `/help` is public (not behind auth) — accessible without sign-in
8. Test Help link in Header nav — visible on chat, tools, admin pages
