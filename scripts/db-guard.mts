/**
 * `tsx scripts/db-guard.mts "<what this is about to do>"` — refuse a database
 * that is not local, then get out of the way.
 *
 * The Prisma CLI takes its connection string from the environment and offers no
 * hook to inspect it first, so the two commands that can lose data without
 * asking are fronted by this instead:
 *
 *   - `prisma db push` diffs the schema straight onto the database. A removed
 *     field is a dropped column, and `--accept-data-loss` turns the one warning
 *     into a flag somebody types once.
 *   - `prisma migrate dev` is a development command that offers to reset — drop
 *     the schema and replay every migration — whenever it finds drift, which is
 *     exactly what a production database looks like from a laptop.
 *
 * Chained with `&&` in package.json so a refusal stops the command rather than
 * printing beside it.
 *
 * Docs: docs/deployments.md § Which database am I about to hit.
 */
import { config as loadEnv } from "dotenv";

import { assertLocalTarget, NonLocalTargetError } from "../lib/db/target.js";

// The same files, in the same order, that prisma.config.ts reads. A guard that
// resolved a different target from the command it fronts would be worse than
// no guard: it would pass while the command underneath went somewhere else.
loadEnv({ path: [".env.local", ".env"], quiet: true });

const operation = process.argv[2] ?? "run a destructive database command";

try {
  const target = assertLocalTarget(operation);
  console.log(`  target ${target.description}`);
} catch (error) {
  if (error instanceof NonLocalTargetError) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
  throw error;
}
