/**
 * `pnpm db:deploy` — apply pending migrations, after showing what they are.
 *
 * The command underneath is still `prisma migrate deploy`. What changed is that
 * it no longer runs unseen. `migrate deploy` applies **every** pending
 * migration, and the person running it usually has one in mind — theirs. On
 * 2026-09-03 that shipped a new `testimonial` table (#64) to production as a
 * side effect of deploying #66 or #68, from a session that had not reviewed it
 * and did not know it existed. Additive, so nothing broke. A `DROP COLUMN`
 * would have travelled the same path just as quietly.
 *
 * So: print the list, name the database, name the author and PR behind each
 * migration, flag the statements that lose or rewrite data, and require the
 * word back before doing anything. Two words when data is at stake.
 *
 * `--dry-run`  the report and nothing else. Same as `pnpm db:pending`.
 * `--yes`      skip the prompt. For a non-interactive shell that has already
 *              read the report — never as a habit, and there is no flag that
 *              also skips the report.
 *
 * CI is untouched: `.github/workflows/ci.yml` calls `prisma migrate deploy`
 * directly against a throwaway `supabase start` container, where there is
 * nothing to review and nobody to prompt.
 *
 * Docs: docs/deployments.md § Schema does not deploy with the code.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { print, report, risky } from "./pending-migrations.mjs";
import { assertLocalTarget } from "../lib/db/target.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const assumeYes = args.has("--yes");

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/*
   Deliberately not an unconditional host check.

   This is the one destructive command whose *purpose* is to reach production —
   docs/deployments.md § Schema does not deploy with the code — and the prompt
   below is already a real guard: it names the target, lists the migrations, and
   asks for "apply destructive" when data is at stake. Refusing a remote here
   outright would put friction on the intended path, which is how a guard gets
   deleted rather than obeyed.

   The hole is `--yes`, which skips all of that and is exactly what a script
   reaches for. So the host is asserted only when nobody is going to be asked.
   See lib/db/target.ts.
*/
if (assumeYes) {
  assertLocalTarget("apply migrations unattended (--yes)");
}

const result = await report();
print(result);

if (result.failed.length > 0) {
  console.error("  Refusing: a previous migration is in a failed state.");
  console.error("  Resolve it with `prisma migrate resolve` before deploying.\n");
  process.exit(1);
}

if (result.pending.length === 0 || dryRun) {
  process.exit(0);
}

const dangerous = risky(result);

if (!assumeYes) {
  // A pipe or a CI shell cannot answer, and defaulting to yes there is how this
  // becomes invisible again. `--yes` is the deliberate way through.
  if (!stdin.isTTY) {
    console.error("  Refusing: not a terminal, and nothing typed `--yes`.\n");
    process.exit(1);
  }

  const word = dangerous.length > 0 ? "apply destructive" : "apply";
  if (dangerous.length > 0) {
    console.log(
      `  ${dangerous.length} statement(s) above lose or rewrite data. Read them again.`,
    );
  }
  console.log(`  This applies ${result.pending.length} migration(s) to ${result.target}.`);

  const answer = await ask(`  Type "${word}" to continue: `);
  if (answer !== word) {
    console.log("\n  Nothing applied.\n");
    process.exit(1);
  }
}

console.log("");
const child = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "inherit" });
process.exit(child.status ?? 1);
