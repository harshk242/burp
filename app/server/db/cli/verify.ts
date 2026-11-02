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
