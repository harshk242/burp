import { createDrizzle, openDatabase } from "../app/server/db/connection";
import { createAccessRequestQueries } from "../app/server/db/queries/access-requests";

/**
 * Approve user access request by email
 * Usage: bun scripts/approve-access.ts <email>
 * Example: bun scripts/approve-access.ts abcd@gmail.com
 *
 * Opens the DB directly (no migrations, no config.yaml): run it against a DB
 * the app has already booted on.
 */

const email = process.argv[2];

if (!email) {
  console.error("❌ Usage: bun scripts/approve-access.ts <email>");
  console.error("Example: bun scripts/approve-access.ts user@example.com");
  process.exit(1);
}

const sqlite = openDatabase(process.env.DATABASE_URL || "/app/data/app.db");
const accessRequestQueries = createAccessRequestQueries(createDrizzle(sqlite));

try {
  // Find the request
  const request = accessRequestQueries.findByEmail(email);

  if (!request) {
    console.log(`❌ No access request found for ${email}`);
    process.exitCode = 1;
  } else {
    console.log("Found request:", request);

    // Approve it (no reviewing admin when run from the CLI)
    accessRequestQueries.approve(request.id, null);

    // Verify
    console.log("✅ Approved:", accessRequestQueries.findById(request.id));
  }
} finally {
  sqlite.close();
}
