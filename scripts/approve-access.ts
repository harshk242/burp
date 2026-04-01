import { Database } from "bun:sqlite";

/**
 * Approve user access request by email
 * Usage: bun scripts/approve-access.ts <email>
 * Example: bun scripts/approve-access.ts abcd@gmail.com
 */

const email = process.argv[2];

if (!email) {
  console.error("❌ Usage: bun scripts/approve-access.ts <email>");
  console.error("Example: bun scripts/approve-access.ts user@example.com");
  process.exit(1);
}

const dbPath = process.env.DATABASE_URL || "/app/data/app.db";
const db = new Database(dbPath);
db.run("PRAGMA foreign_keys = ON");

// Find the request
const request = db.prepare("SELECT * FROM access_requests WHERE email = ?").get(email);

if (!request) {
  console.log(`❌ No access request found for ${email}`);
  process.exit(1);
}

console.log("Found request:", request);

// Approve it
db.prepare(
  "UPDATE access_requests SET status = 'approved', reviewed_at = unixepoch() WHERE email = ?"
).run(email);

// Verify
const updated = db.prepare("SELECT * FROM access_requests WHERE email = ?").get(email);
console.log("✅ Approved:", updated);

db.close();
