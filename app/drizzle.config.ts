import { defineConfig } from "drizzle-kit";
import { appConfig } from "./server/config";
import { resolveDbPath } from "./server/db/paths";

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/db/schema/index.ts",
  out: "./server/db/migrations",
  dbCredentials: { url: resolveDbPath(appConfig.server.database_url) },
  tablesFilter: ["!tool_search_fts*", "!__drizzle_migrations"],
  strict: true,
  verbose: true,
});
