/**
 * Dry-run adoption + migrations against a copy of a database.
 *
 *   bun run db:verify <path> [--keep]     # relative paths resolve against the current directory
 *
 * Prints fingerprint diffs, 0003 backfill counts, NULL-role users, NULL-PK rows,
 * FK violations and the transaction wall-clock time.
 * The input file is never modified. Exits 1 when the copy would not migrate cleanly.
 */
import { resolve } from "path";
import { formatVerifyReport, verifyDatabase, verifyPassed } from "../verify";

const args = process.argv.slice(2);
const pathArg = args.find((a) => !a.startsWith("--"));
if (!pathArg) {
  console.error("Usage: bun run db:verify <path> [--keep]");
  process.exit(2);
}

try {
  const report = verifyDatabase(resolve(pathArg), { keepCopy: args.includes("--keep") });
  console.log(formatVerifyReport(report));
  process.exitCode = verifyPassed(report) ? 0 : 1;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
