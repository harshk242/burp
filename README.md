# Super Bio Agent

A unified AI-powered research platform that connects 10 major biomedical research databases through the Model Context Protocol (MCP). Write natural language queries that seamlessly span across biological research platforms to synthesize complex research questions and conduct end-to-end research workflows.

## Overview

Super Bio Agent integrates the following biomedical research platforms into a single cohesive system:

| Platform | Purpose | Records | Key IDs |
|----------|---------|---------|---------|
| **Open Targets** | Target-disease-drug associations | 45+ evidence sources | Ensembl gene IDs |
| **UniProt** | Protein sequences & annotations | 27M+ proteins | UniProt accessions |
| **Ensembl** | Genomic sequences & annotations | 200+ species | Gene/transcript IDs |
| **ChEMBL** | Bioactive compounds & activities | 2M+ compounds | ChEMBL IDs |
| **PubChem** | Chemical structure database | 110M+ compounds | CID |
| **ClinicalTrials** | Clinical trial registry | 400K+ trials | NCT IDs |
| **ClinVar** | Genetic variants & phenotypes | 1.2M+ variants | rsID, variant IDs |
| **PubMed** | Biomedical literature | 35M+ citations | PMID |
| **Reactome** | Biological pathways | 2,500+ pathways | Reactome IDs |
| **PharmGKB (ClinPGx)** | Pharmacogenomics & drug response | Gene-drug interactions | Gene symbols |

## Key Features

✨ **Unified Query Interface**: Ask complex questions that span multiple biological databases in natural language

🔗 **Intelligent ID Mapping**: Seamlessly translate between 12+ identifier systems (genes, proteins, compounds, variants, etc.)

🔀 **40+ Connection Paths**: Pre-mapped workflows connecting all platforms for integrated research analysis

📊 **Multi-Format Output**: Results available in JSON, FASTA, GFF, VCF, XML, CSV formats depending on the platform

⚡ **Batch Processing**: Efficiently query multiple entities simultaneously with built-in rate limit compliance

🧬 **End-to-End Workflows**: Automate complex research pipelines like target validation, drug repurposing, and biomarker discovery

## Example Queries

```
"Find all genes associated with Alzheimer's disease,
 get their protein structures from UniProt,
 find small molecule compounds that interact with these proteins,
 and show ongoing clinical trials testing these compounds."

"What kinase inhibitors are in clinical trials for cancer?
 Get their chemical structures, predicted ADMET properties,
 and pharmacogenomic considerations for patient stratification."

"For a given genetic variant, show the gene it affects,
 the protein change, associated diseases,
 relevant clinical trials, and literature citations."
```

## Project Structure

```
super-bio-agent/
├── app/
│   ├── server/                    # Hono backend API
│   └── web/                       # Next.js frontend
│
├── mcp-servers/
│   ├── open-targets/              # Target-disease-drug integration hub
│   ├── uniprot/                   # Protein sequences & annotations
│   ├── ensembl/                   # Genomic sequences & gene annotations
│   ├── chembl/                    # Bioactive compounds & targets
│   ├── pubchem/                   # Chemical structure database
│   ├── clinical-trials/           # Clinical trial registry
│   ├── clinvar/                   # Genetic variants & phenotypes
│   ├── pubmed/                    # Biomedical literature
│   ├── reactome/                  # Biological pathways
│   └── clinpgx/                   # Pharmacogenomics
│
├── docs/                          # Documentation
├── scripts/                       # Utility scripts
├── .mcp.json                      # MCP server configuration
├── .env.local                     # Environment variables (API keys)
└── CLAUDE.md                      # Build & deployment instructions
```

## Getting Started

### Prerequisites

1. **Bun** package manager
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Node.js** 18+ (included with Bun)

3. **API Keys** — Get these before starting:
   - **Anthropic API Key**: Get from [Anthropic Console](https://console.anthropic.com/)
   - **Clerk API Key**: Get from [Clerk Dashboard](https://dashboard.clerk.com)
   - **NCBI API Key** (optional, but recommended for higher rate limits): Get from [NCBI](https://www.ncbi.nlm.nih.gov/account/)

### Installation Steps

#### 1. **Clone & Install Dependencies**
```bash
git clone <repository-url>
cd super-bio-agent

# Install root dependencies (if any)
bun install

# Install server dependencies
cd app
bun install

# Install web (frontend) dependencies
cd web
bun install
cd ../..
```

#### 2. **Setup Clerk Authentication**

Go to [Clerk Dashboard](https://dashboard.clerk.com):
- Create a new application (if you haven't)
- Copy your **Publishable Key** and **Secret Key**
- You'll use these in the environment variables

#### 3. **Environment Variables**

**For the backend** (`app/.env`):
```bash
cd app
cp .env.example .env
```

Edit `app/.env` and fill in:
```env
# Required
ANTHROPIC_API_KEY=sk-ant-...
CLERK_SECRET_KEY=sk_test_...

# Recommended
NCBI_API_KEY=<your-ncbi-key>

# Optional
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3000
DATABASE_URL=./data/super-bio-agent.db
MCP_SERVERS_BASE=../mcp-servers
ADMIN_EMAIL=you@example.com
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

**For the frontend** (`app/web/.env.local`):
```bash
cd web
cp .env.example .env.local
```

Edit `app/web/.env.local`:
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_API_URL=http://localhost:3000
```

#### 4. **Build MCP Servers** (one-time)
```bash
cd super-bio-agent

# Build all servers (from root)
for dir in mcp-servers/*/; do
  cd "$dir"
  bun install
  bun run build 2>/dev/null || true  # Some servers may not have a build script
  cd ../../
done
```

Or build individual servers as needed:
```bash
cd mcp-servers/uniprot
bun install
bun run build
cd ../..
```

### Running the Application

#### **Option 1: Development Mode** (recommended)

Terminal 1 — Backend:
```bash
cd app
bun run dev
# Server runs on http://localhost:3000
```

Terminal 2 — Frontend:
```bash
cd app/web
bun run dev
# Frontend runs on http://localhost:3001
```

Then open http://localhost:3001 in your browser.

#### **Option 2: Production Mode**

Backend:
```bash
cd app
bun run start
```

Frontend:
```bash
cd app/web
bun run build
bun run start
```

### Database Setup (First Time)

```bash
cd app
bun run db:init
```

This initializes the SQLite database at `./data/super-bio-agent.db`.

### Verification Checklist

- [ ] Bun installed: `bun --version`
- [ ] Dependencies installed: Check `app/node_modules` and `app/web/node_modules` exist
- [ ] Environment variables set in both `app/.env` and `app/web/.env.local`
- [ ] Clerk keys are valid (test by visiting login page at http://localhost:3001)
- [ ] MCP servers built: Check `mcp-servers/*/dist` or `mcp-servers/*/build` folders exist
- [ ] Backend starts: `bun run dev` in `app/` should show "Server running"
- [ ] Frontend starts: `bun run dev` in `app/web/` should show "ready - started server on ..."

### Troubleshooting

**"Port already in use"**
- Backend uses 3000, frontend uses 3001. Stop other services or change port in scripts.

**"Clerk authentication fails"**
- Verify `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set in `app/web/.env.local`
- Make sure it matches your Clerk application

**"MCP servers not found"**
- Ensure all servers are built: `cd mcp-servers/<server> && bun run build`
- Check `.mcp.json` paths match your actual build output directories

**"Database errors"**
- Run: `bun run db:init` from `app/` directory
- Check file permissions on `./data/` directory

### Configuration

The `.mcp.json` file configures how all 10 servers are launched:

```json
{
  "mcpServers": {
    "open-targets": {
      "command": "node",
      "args": ["mcp-servers/open-targets/dist/index.js"]
    },
    "chembl": {
      "command": "node",
      "args": ["mcp-servers/chembl/build/index.js"]
    },
    // ... more servers
  }
}
```

## Usage

### With Claude Desktop

1. **Add to Claude Desktop configuration** (`~/.claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "super-bio-agent": {
         "command": "node",
         "args": ["<path-to-super-bio-agent>/.mcp.json"]
       }
     }
   }
   ```

2. **Use in conversations** with Claude:
   ```
   "Find all kinase inhibitors in clinical trials that target
    proteins associated with HER2-positive breast cancer"
   ```

### Programmatically

Each server implements the MCP protocol and exposes 15-27 specialized tools:

```typescript
// Access through any MCP client
const openTargets = mcpClient.getServer('open-targets');
const targets = await openTargets.callTool('get_target_associated_diseases', {
  ensembl_id: 'ENSG00000157764'  // BRCA2
});
```

## Platforms & Tools

### Open Targets (45+ tools)
Hub for target-disease-drug associations. Links all platforms together.
- Target information & validation
- Disease associations
- Drug mechanisms
- Genetic evidence
- Literature & clinical trials

### UniProt (26 tools)
Protein sequences and functional annotations.
- Protein lookup & cross-references
- Orthologs & homologs
- Domains & pathways
- Post-translational modifications
- Interactions & complexes

### Ensembl (25 tools)
Genomic sequences and gene annotations for 200+ species.
- Gene & transcript lookup
- DNA sequence retrieval
- Variant consequence prediction
- Homologs across species
- Regulatory features
- Coordinate mapping between assemblies

### ChEMBL (27 tools)
Bioactive compounds and target interactions (2M+ compounds).
- Compound search & similarity
- Target screening data
- Bioactivity results
- Drug development phases
- ADMET prediction
- Mechanism of action

### PubChem (24 tools)
Chemical structures and properties (110M+ compounds).
- Compound search by name, SMILES, InChI
- 2D/3D conformers
- Molecular properties
- Bioassay results
- Toxicity & safety data
- Patent information

### ClinicalTrials (18 tools)
Clinical trial registry (400K+ trials from 220+ countries).
- Trial search by condition, intervention, location
- Recruitment status
- Trial outcomes & results
- Eligibility criteria
- Pediatric & rare disease filters
- Timeline analysis

### ClinVar (12 tools)
Genetic variants and phenotype associations (1.2M+ variants).
- Variant lookup by gene, coordinates, rsID
- Clinical significance assessment
- Submission details & conflicts
- Population frequencies
- Pharmacogenomic annotations

### PubMed (13 tools)
Biomedical literature (35M+ citations).
- Article search
- Citation networks
- Author searches
- MeSH term indexing
- Publication trends
- Full-text availability

### Reactome (8 tools)
Manually curated biological pathways (2,500+ pathways).
- Pathway search & hierarchy
- Reaction participants
- Gene-pathway associations
- Cross-species pathways

### PharmGKB (16 tools)
Pharmacogenomics and personalized medicine.
- Gene-drug interactions
- Star alleles (CYP2D6, etc.)
- Dosing guidelines (CPIC, DPWG)
- Drug response associations
- FDA drug labels with PGx info

## Documentation

- **`docs/PLATFORM_OVERVIEW_AND_CONNECTIONS.md`**: Complete platform descriptions and all 40+ inter-platform connection workflows
- **`docs/research-platform-strategy.md`**: Project vision, strategy, and roadmap for computational intelligence features
- **Individual server READMEs**: Detailed tool documentation for each platform in `mcp-servers/*/README.md`

## Architecture

### Technology Stack
- **SDK**: Model Context Protocol (MCP)
- **Language**: TypeScript + Node.js 18+
- **Package Manager**: Bun
- **HTTP Client**: Axios
- **Type Safety**: Full TypeScript with @types

### Connection Model

The platform uses three types of connections between platforms:

1. **Bidirectional**: Data flows both directions
   - Example: ChEMBL ↔ UniProt (via protein targets)
   - Example: Ensembl ↔ ClinVar (via genomic coordinates)

2. **Unidirectional**: One-way data integration
   - Open Targets integrates evidence from ClinVar, ClinicalTrials, PubMed
   - ChEMBL → PubMed (literature links)

3. **Total Paths**: 40+ documented workflows connecting the platforms

## API Integration

All platforms provide public REST APIs with the following characteristics:

| Platform | Rate Limit | Authentication | Batch Support |
|----------|-----------|-----------------|----------------|
| ChEMBL | Reasonable | No | Yes (1-50) |
| UniProt | 1 req/sec | No | Yes |
| Ensembl | 15 req/sec | No | Yes |
| PubChem | No limit | No | Yes |
| ClinicalTrials | Reasonable | No | No |
| ClinVar | Moderate | Optional API key | No |
| PubMed | Depends on key | Optional API key | Yes |
| Reactome | Reasonable | No | No |
| PharmGKB | Reasonable | No | No |
| Open Targets | GraphQL API | No | Yes |

## Development

### Building a Single Server

```bash
cd mcp-servers/chembl
bun install
bun run build
```

### Development Mode

```bash
# Watch mode compilation
bun run dev

# Run specific server in development
node build/index.js
```

### Adding a New Server

Each MCP server follows this structure:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "platform-name",
  version: "1.0.0",
});

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "tool_name",
      description: "Tool description",
      inputSchema: {
        type: "object",
        properties: { /* parameters */ },
        required: ["param1", "param2"]
      }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Implementation
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Use Cases

### 1. **Target Validation**
- Find a gene target
- Get protein structure & function
- Find compounds that interact with it
- Check clinical trials using those compounds
- Review literature evidence

### 2. **Drug Repurposing**
- Identify a disease
- Find approved drugs in clinical use
- Check their targets
- Find other diseases those targets are associated with
- Predict new indications

### 3. **Biomarker Discovery**
- Start with a disease
- Find associated genetic variants
- Map to genes & proteins
- Check tissue expression
- Link to diagnostic compounds & assays

### 4. **Personalized Medicine**
- Analyze patient's genetic variants
- Check pharmacogenomic profiles
- Get dosing recommendations
- Identify relevant clinical trials
- Find alternative drugs based on genetic profile

## Roadmap

- [ ] Enhanced ID mapping automation
- [ ] Workflow templates for common research scenarios
- [ ] Artifact generation (reports, code, visualizations)
- [ ] Computational prioritization algorithms
- [ ] Gap analysis (what data is missing)
- [ ] Hypothesis generation from cross-platform data
- [ ] Result export to R/Python for further analysis
- [ ] Reproducibility & versioning of research workflows

## Contributing

This is a research project integrating public biomedical databases. Contributions welcome for:

- Adding new platforms
- Improving tool definitions
- Enhancing documentation
- Bug fixes and optimizations
- Integration examples

## License

[Specify your license - MIT, Apache 2.0, etc.]

## Citation

If you use Super Bio Agent in your research, please cite:

```bibtex
@software{super_bio_agent,
  title={Super Bio Agent: Unified AI-Powered Biomedical Research Platform},
  author={[Your Name/Organization]},
  year={2024},
  url={https://github.com/[your-repo]}
}
```

## Support & Issues

- 📖 **Documentation**: See `PLATFORM_OVERVIEW_AND_CONNECTIONS.md` for detailed platform mappings
- 🐛 **Issues**: Report bugs on GitHub
- 💬 **Questions**: Open a discussion

## Acknowledgments

This project integrates public data from:
- EMBL-EBI (ChEMBL, UniProt, Ensembl, Reactome)
- NCBI (PubMed, ClinVar)
- NIH (Open Targets, ClinicalTrials.gov)
- PubChem
- PharmGKB

All data is used in compliance with the respective platform's terms of service.

---

**Made with 🧬 for bioinformatics research**
