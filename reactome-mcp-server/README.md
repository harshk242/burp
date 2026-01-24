# Reactome MCP Server 🧬

Model Context Protocol server for accessing Reactome pathway and systems biology data.

[![API](https://img.shields.io/badge/Reactome-v79-blue)](https://reactome.org/)

Developed by [Augmented Nature](https://augmentednature.ai) - Advancing AI for Scientific Discovery

## ✅ **Verified Features**

**All 8 tools working with live Reactome API data:**

- 🔍 **Pathway Search** - Search biological pathways by name, process, keywords
- 📊 **Pathway Details** - Comprehensive pathway information and components
- 🧬 **Gene-to-Pathways** - Find pathways containing specific genes/proteins
- 🦠 **Disease Pathways** - Disease-associated biological mechanisms
- 🌲 **Pathway Hierarchy** - Parent/child relationships and pathway structure
- 🧪 **Pathway Participants** - All molecules participating in pathways
- ⚗️ **Biochemical Reactions** - Detailed reaction information
- 🔗 **Protein Interactions** - Molecular interactions within pathways

## 🚀 **Quick Start**

```bash
# Install and build
bun install
bun run build

# Run the server
node build/index.js
```

## 📋 **MCP Client Configuration**

### Claude Desktop

```json
{
  "mcpServers": {
    "reactome-server": {
      "command": "node",
      "args": ["/path/to/reactome-server/build/index.js"]
    }
  }
}
```

### Other MCP Clients

```bash
node /path/to/reactome-server/build/index.js
```

## 🛠️ **Available Tools**

### 🔍 `search_pathways`

**Search for biological pathways by name, description, or keywords**

```json
{
  "name": "search_pathways",
  "arguments": {
    "query": "cell cycle", // Pathway name, process, or keywords
    "type": "pathway", // Optional: pathway, reaction, protein, complex, disease
    "size": 20 // Optional: 1-100 results (default: 20)
  }
}
```

**Example Results:**

- **Cell Cycle** (R-HSA-1640170) - Cell cycle progression and regulation
- **Cell Cycle Checkpoints** (R-HSA-69620) - Quality control mechanisms
- **Mitotic G1-G1/S phases** (R-HSA-453279) - G1 phase progression

### 📊 `get_pathway_details`

**Get comprehensive information about a specific pathway**

```json
{
  "name": "get_pathway_details",
  "arguments": {
    "id": "R-HSA-1640170" // Reactome pathway stable identifier
  }
}
```

### 🧬 `find_pathways_by_gene`

**Find all pathways containing a specific gene or protein**

```json
{
  "name": "find_pathways_by_gene",
  "arguments": {
    "gene": "BRCA1", // Gene symbol or UniProt ID
    "species": "Homo sapiens" // Optional: species (default: Homo sapiens)
  }
}
```

### 🦠 `find_pathways_by_disease`

**Find disease-associated pathways and mechanisms**

```json
{
  "name": "find_pathways_by_disease",
  "arguments": {
    "disease": "cancer", // Disease name or DOID identifier
    "size": 25 // Optional: 1-100 pathways (default: 25)
  }
}
```

### 🌲 `get_pathway_hierarchy`

**Get hierarchical structure and parent/child relationships**

```json
{
  "name": "get_pathway_hierarchy",
  "arguments": {
    "id": "R-HSA-1640170" // Reactome pathway stable identifier
  }
}
```

### 🧪 `get_pathway_participants`

**Get all molecules (proteins, genes, compounds) in a pathway**

```json
{
  "name": "get_pathway_participants",
  "arguments": {
    "id": "R-HSA-1640170" // Reactome pathway stable identifier
  }
}
```

### ⚗️ `get_pathway_reactions`

**Get all biochemical reactions within a pathway**

```json
{
  "name": "get_pathway_reactions",
  "arguments": {
    "id": "R-HSA-1640170" // Reactome pathway stable identifier
  }
}
```

### 🔗 `get_protein_interactions`

**Get protein-protein interactions within pathways**

```json
{
  "name": "get_protein_interactions",
  "arguments": {
    "pathwayId": "R-HSA-1640170", // Reactome pathway stable identifier
    "interactionType": "all" // Optional: protein-protein, regulatory, catalysis, all
  }
}
```

## 📚 **Resource Templates**

Access Reactome data through standardized URIs:

- `reactome://pathway/{id}` - Complete pathway information
- `reactome://reaction/{id}` - Detailed reaction information
- `reactome://protein/{id}` - Protein details and associations
- `reactome://disease/{id}` - Disease-associated pathways
- `reactome://search/{query}` - Search results

## 🧪 **Real-World Examples**

### Systems Biology Workflow

```bash
# 1. Search for DNA repair pathways
{"name": "search_pathways", "arguments": {"query": "DNA repair", "size": 10}}

# 2. Get detailed pathway information
{"name": "get_pathway_details", "arguments": {"id": "R-HSA-5696394"}}

# 3. Find all pathways containing BRCA1
{"name": "find_pathways_by_gene", "arguments": {"gene": "BRCA1"}}

# 4. Get pathway participants
{"name": "get_pathway_participants", "arguments": {"id": "R-HSA-5696394"}}
```

### Disease Mechanism Research

```bash
# 1. Search for cancer-related pathways
{"name": "find_pathways_by_disease", "arguments": {"disease": "cancer", "size": 15}}

# 2. Get pathway hierarchy for oncogenic signaling
{"name": "get_pathway_hierarchy", "arguments": {"id": "R-HSA-5637815"}}

# 3. Analyze biochemical reactions
{"name": "get_pathway_reactions", "arguments": {"id": "R-HSA-5637815"}}
```

### Drug Discovery Pipeline

```bash
# 1. Find pathways for drug target
{"name": "find_pathways_by_gene", "arguments": {"gene": "EGFR"}}

# 2. Get protein interactions in pathway
{"name": "get_protein_interactions", "arguments": {"pathwayId": "R-HSA-177929"}}

# 3. Analyze pathway participants
{"name": "get_pathway_participants", "arguments": {"id": "R-HSA-177929"}}
```

## 🔬 **Data Coverage**

**Reactome provides curated data for:**

- **25,000+ reactions** across all major biological processes
- **14,000+ proteins** with detailed functional annotations
- **2,500+ pathways** covering cellular and molecular processes
- **20+ species** including human, mouse, rat, and model organisms
- **Cross-references** to UniProt, ChEMBL, Ensembl, and other databases

**Key Biological Areas:**

- Signal transduction pathways
- Metabolic processes and networks
- Gene regulation and expression
- Cell cycle and DNA repair
- Immune system responses
- Disease mechanisms and drug action
- Developmental biology processes

## 🏗️ **Architecture**

- **TypeScript** implementation with robust type safety
- **Reactome Content Service API** for efficient data retrieval
- **MCP Protocol** compliant JSON-RPC communication
- **Error Handling** with comprehensive validation
- **Production Ready** with 30s timeouts and proper logging

## 📊 **API Information**

- **Base URL**: `https://reactome.org/ContentService`
- **Version**: Reactome v79 (latest)
- **Rate Limits**: Generous for research use
- **Authentication**: None required
- **Format**: REST API with JSON responses
