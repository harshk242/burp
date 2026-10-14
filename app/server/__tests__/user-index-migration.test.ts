import { expect, it } from "bun:test";
import { createTestDb } from "../__test-utils__/db";
import { migrationsFolderUpTo } from "../__test-utils__/migrations";
import { runMigrations } from "../db/migrate";

for (const indexesPresent of [true, false]) {
  it(`0018 removes redundant user indexes with indexes present=${indexesPresent} and preserves uniqueness`, () => {
    const { sqlite } = createTestDb({ migrationsFolder: migrationsFolderUpTo("0017_turn_usage_identity") });
    try {
      sqlite.run("INSERT INTO users (id, clerk_id, email) VALUES ('u1', 'clerk1', 'a@example.com')");
      if (!indexesPresent) {
        sqlite.run("DROP INDEX idx_users_clerk_id");
        sqlite.run("DROP INDEX idx_users_email");
      }
      expect(runMigrations(sqlite).applied.map((m) => m.tag)).toEqual(["0018_drop_redundant_user_indexes"]);
      const indexes = sqlite.query<{ name: string }, []>("PRAGMA index_list(users)").all().map((row) => row.name);
      expect(indexes).not.toContain("idx_users_clerk_id");
      expect(indexes).not.toContain("idx_users_email");
      expect(indexes).toContain("users_clerk_id_unique");
      expect(indexes).toContain("users_email_unique");
      expect(() => sqlite.run("INSERT INTO users (id, clerk_id, email) VALUES ('u2', 'clerk1', 'b@example.com')")).toThrow(/UNIQUE/);
      expect(() => sqlite.run("INSERT INTO users (id, clerk_id, email) VALUES ('u3', 'clerk3', 'a@example.com')")).toThrow(/UNIQUE/);
      expect(runMigrations(sqlite).applied).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
}
