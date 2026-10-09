-- Custom SQL migration file, put your code below! --
-- FTS5 virtual tables can't be modelled in Drizzle; drizzle.config.ts filters tool_search_fts* out.
-- IF NOT EXISTS keeps this a no-op on adopted legacy DBs, which already have the table.
CREATE VIRTUAL TABLE IF NOT EXISTS tool_search_fts USING fts5(
  full_name,
  server,
  tool_name,
  description,
  tokenize='porter unicode61'
);
