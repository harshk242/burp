import { defineConfig } from "drizzle-kit";
import { appConfig } from "./server/config";
import { resolveDbPath } from "./server/db/paths";

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/db/schema/index.ts",
  out: "./server/db/migrations",
  // Only used by studio/pull; generate/check never touch a database.
  dbCredentials: { url: resolveDbPath(appConfig.server.database_url) },
  // FTS5 shadow tables are owned by 0001_tool_search_fts; history by the executor.
  tablesFilter: ["!tool_search_fts*", "!__drizzle_migrations"],
  strict: true,
  verbose: true,
});
