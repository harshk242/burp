/**
 * Rebuild the tool embeddings index from scratch.
 *
 * Spawns the unified MCP server, lists all tools, embeds them with the
 * embedder configured in config.yaml (`embedding:`), and writes the v2 index
 * to `tool_search.embeddings_path`. No model names live here: to try another
 * model, override provider AND model, e.g.
 *   EMBEDDING_PROVIDER=google EMBEDDING_MODEL=gemini-embedding-001 bun run generate:embeddings
 *
 * Usage: bun run generate:embeddings   (from repo root or app/)
 * Env: the configured provider's key (OPENAI_API_KEY by default; GEMINI_API_KEY for google)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "path";
import { appConfig } from "../server/config";
import { createEmbedder, toolEmbeddingText, writeToolEmbeddings } from "../server/embeddings";

async function main() {
  const embedder = createEmbedder(appConfig.embedding);
  if (!embedder) {
    console.error(`No API key for embedding provider "${appConfig.embedding.provider}". Set it in .env and retry.`);
    process.exit(1);
  }
  const outputPath = appConfig.tool_search.embeddings_path;

  console.log("Starting MCP server...");
  const transport = new StdioClientTransport({
    command: "node",
    args: [join(appConfig.server.mcp_servers_base, "dist", "index.js")],
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: "embedding-generator", version: "1.0.0" }, { capabilities: {} });

  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  console.log(`Found ${tools.length} tools`);
  if (tools.length === 0) throw new Error("MCP server listed no tools");

  // The unified server returns full names ("chembl__search_compounds"), matching the registry.
  const texts = tools.map((t) => toolEmbeddingText(t.name, t.description || ""));

  console.log(`Embedding with ${embedder.id}...`);
  const vectors = await embedder.embedDocuments(texts);

  await writeToolEmbeddings(
    outputPath,
    { embedder: embedder.id, dimension: vectors[0].length },
    tools.map((t, i) => ({ fullName: t.name, text: texts[i], vector: vectors[i] }))
  );
  console.log(`Wrote ${tools.length} embeddings (${embedder.id}, ${vectors[0].length} dims) to ${outputPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
