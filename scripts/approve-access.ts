import { createDrizzle, openDatabase } from "../app/server/db/connection";
import { createAccessRequestQueries } from "../app/server/db/queries/access-requests";

const email = process.argv[2];

if (!email) {
  console.error("❌ Usage: bun scripts/approve-access.ts <email>");
  console.error("Example: bun scripts/approve-access.ts user@example.com");
  process.exit(1);
}

const sqlite = openDatabase(process.env.DATABASE_URL || "/app/data/app.db");
const accessRequestQueries = createAccessRequestQueries(createDrizzle(sqlite));

try {
  const request = accessRequestQueries.findByEmail(email);

  if (!request) {
    console.log(`❌ No access request found for ${email}`);
    process.exitCode = 1;
  } else {
    console.log("Found request:", request);

    accessRequestQueries.approve(request.id, null);

    console.log("✅ Approved:", accessRequestQueries.findById(request.id));
  }
} finally {
  sqlite.close();
}
