import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";

export interface ToolSearchRow {
  full_name: string;
  server: string;
  tool_name: string;
  description: string;
  rank: number;
}

export function createToolSearchQueries(db: DrizzleDb) {
  return {
    clearAll() {
      db.run(sql`DELETE FROM tool_search_fts`);
    },

    insertTool(fullName: string, server: string, toolName: string, description: string) {
      db.run(
        sql`INSERT INTO tool_search_fts (full_name, server, tool_name, description)
            VALUES (${fullName}, ${server}, ${toolName}, ${description})`
      );
    },

    searchBM25(query: string, limit: number = 20): ToolSearchRow[] {
      return db.all<ToolSearchRow>(
        sql`SELECT full_name, server, tool_name, description, rank
            FROM tool_search_fts
            WHERE tool_search_fts MATCH ${query}
            ORDER BY rank
            LIMIT ${limit}`
      );
    },
  };
}
