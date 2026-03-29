/**
 * Generate tool embeddings for semantic search.
 *
 * Spawns the unified MCP server, lists all tools, embeds their
 * descriptions via Gemini embedding-001, and writes to data/tool-embeddings.json.
 *
 * Usage: bun run scripts/generate-tool-embeddings.ts
 * Env: GEMINI_API_KEY (required)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embedMany } from "ai";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is required");
  process.exit(1);
}

const MCP_SERVERS_BASE = process.env.MCP_SERVERS_BASE || "mcp-servers";
const OUTPUT_PATH = join(process.cwd(), "data", "tool-embeddings.json");
const BATCH_SIZE = 100;

async function main() {
  console.log("Starting MCP server...");

  const transport = new StdioClientTransport({
    command: "node",
    args: [`${MCP_SERVERS_BASE}/unified/dist/index.js`],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client(
    { name: "embedding-generator", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected to MCP server");

  const { tools } = await client.listTools();
  console.log(`Found ${tools.length} tools`);

  const texts = tools.map((t) => `${t.name}: ${t.description || ""}`);
  const names = tools.map((t) => t.name);

  const google = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
  const model = google.embedding("gemini-embedding-001");

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    console.log(`Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)} (${batch.length} tools)...`);

    const { embeddings } = await embedMany({ model, values: batch });
    allEmbeddings.push(...embeddings);
  }

  const output = {
    model: "gemini-embedding-001",
    dimension: allEmbeddings[0]?.length ?? 768,
    generated_at: new Date().toISOString(),
    tools: names.map((name, i) => ({
      full_name: name,
      text: texts[i],
      embedding: allEmbeddings[i],
    })),
  };

  const outDir = dirname(OUTPUT_PATH);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  console.log(`Wrote ${output.tools.length} embeddings to ${OUTPUT_PATH}`);

  await transport.close();
  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
