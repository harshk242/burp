import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { users } from "./users";
import { waitlist } from "./waitlist";
import { sessions } from "./sessions";
import { feedback } from "./feedback";
import { tools } from "./tools";
import { chat } from "./chat";
import { usage } from "./usage";
import { admin } from "./admin";
import type { AppEnv } from "../types";

const api = new OpenAPIHono<AppEnv>();

// Mount route modules
api.route("/users", users);
api.route("/waitlist", waitlist);
api.route("/sessions", sessions);
api.route("/messages", feedback);
api.route("/tools", tools);
api.route("/chat", chat);
api.route("/usage", usage);
api.route("/admin", admin);

// Generate OpenAPI spec
api.doc("/doc", {
  openapi: "3.1.0",
  info: {
    title: "BURP API",
    version: "1.0.0",
    description: `API for BURP (Bio Unified Research Platform) - a conversational AI for querying biomedical databases.

## Overview

BURP provides a unified interface to query 10 biomedical databases using natural language:

| Database | Data Type |
|----------|-----------|
| UniProt | Protein sequences and annotations |
| ChEMBL | Drug compounds and bioactivity |
| PubChem | Chemical structures and properties |
| Ensembl | Genomic data and gene annotations |
| ClinVar | Clinical variant interpretations |
| Open Targets | Drug-target associations |
| Reactome | Biological pathways |
| ClinicalTrials | Clinical trial information |
| PubMed | Biomedical literature |
| ClinPGx | Pharmacogenomics data |

## Authentication

Most endpoints require authentication via Clerk. Include the JWT token in the Authorization header:

\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

## Getting Started

1. Request access via \`POST /api/waitlist\`
2. Once approved, sign in via Clerk
3. Start chatting via \`POST /api/chat\`
`,
    contact: {
      name: "BURP",
      url: "https://github.com/your-org/burp",
    },
    license: {
      name: "MIT",
    },
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
  ],
  tags: [
    {
      name: "Chat",
      description: "Chat with the AI agent using natural language",
    },
    {
      name: "Sessions",
      description: "Manage chat sessions and history",
    },
    {
      name: "Tools",
      description: "Browse and directly call MCP tools",
    },
    {
      name: "Users",
      description: "User profile and authentication",
    },
    {
      name: "Waitlist",
      description: "Access request management",
    },
    {
      name: "Admin",
      description: "Admin-only user management and rate limit overrides",
    },
  ],
  security: [{ bearerAuth: [] }],
});

// Register security scheme
api.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Clerk JWT token",
});

// Swagger UI
api.get(
  "/swagger",
  swaggerUI({
    url: "/api/doc",
    title: "BURP API",
  })
);

// API root - redirect to swagger
api.get("/", (c) => {
  return c.redirect("/api/swagger");
});

export { api };
