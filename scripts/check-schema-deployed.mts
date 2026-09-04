/**
 * Refuse to build production while the database is behind the code.
 *
 * ## The incident this exists for
 *
 * On 2026-09-04 seven migrations from #75, #77, #79 (x3), #80 and #85 sat
 * unapplied while their code ran in production. The home page, every category
 * shelf, every storefront, `/pricing` and `/search` returned 500 for about six
 * hours. Only build-time prerenders kept serving — `/categories`, `/guides`,
 * `robots.txt` — which made the failure look like a runtime connection problem
 * and cost an hour of misdiagnosis before Vercel's runtime log named the column.
 *
 * `docs/deployments.md` § Ordering already carries the rule: a migration that
 * adds a table, column, index or constraint nothing yet reads is applied BEFORE
 * the merge. All seven were additive. The rule was written down, and nothing
 * checked it.
 *
 * ## Why it fails the build rather than cancelling the deploy
 *
 * `scripts/vercel-ignore-build.sh` looks like the natural home — it already runs
 * before every production build and already cancels one by exiting 0. It cannot
 * host this. Vercel runs the Ignored Build Step before installing dependencies,
 * so there is no `pg`, no `dotenv` and no `tsx` in that container, and reaching
 * Postgres from plain Node without a driver is not a thing worth writing.
 *
 * So the check runs from the `build` script, where the dependencies exist and
 * the build is about to connect to the same database anyway to prerender. A
 * non-zero exit marks the deployment ERROR, and Vercel keeps serving the
 * previous one — which is the outcome that matters. The site stays up on the
 * schema it already matches.
 *
 * The cost of being wrong in that direction is one wasted build. The cost of
 * being wrong in the other direction was six hours.
 *
 * ## Fails towards deploying
 *
 * No database URL, an unreachable database, a build that is not production: all
 * pass. `vercel-ignore-build.sh` makes the same choice for the same reason — a
 * guard that stops production deploys on a network blip is a guard somebody
 * deletes within the week. The build's own prerendering will fail loudly enough
 * if the database is genuinely gone.
 *
 * ## The one legitimate pending migration
 *
 * `docs/deployments.md`'s ordering table has a row this would otherwise break:
 * a migration that DROPS or renames anything is applied *after* the merge, once
 * no running code refers to the thing. That migration is legitimately pending
 * while its build runs.
 *
 * `ALLOW_PENDING_MIGRATIONS` is how that deploy gets through, and it is
 * deliberately not a boolean: it must name the migrations it is unlocking, so
 * that a value set for one deploy cannot silently cover the next one. Set it on
 * the deployment, not on the project.
 *
 * Docs: docs/deployments.md, docs/shelf-cost.md § PR 1.
 */
import { decide } from "../lib/db/schema-deployed.js";
import { print, report } from "./pending-migrations.mjs";

/** True for a Vercel production build, and for nothing else. */
function isProductionBuild(env: NodeJS.ProcessEnv): boolean {
  return env["VERCEL_ENV"] === "production";
}

async function main(): Promise<void> {
  const production = isProductionBuild(process.env);

  let pending: string[];
  try {
    const result = await report();
    pending = result.pending.map((p) => p.name);
    if (pending.length > 0 || result.failed.length > 0 || result.unknown.length > 0) {
      print(result);
    }
  } catch (error) {
    // Fails towards deploying. See the header.
    console.log(
      `\n  check:schema-deployed — skipped: ${(error as Error).message}`,
    );
    console.log("  The build will fail on its own if the database is genuinely unreachable.\n");
    return;
  }

  const verdict = decide({
    isProductionBuild: production,
    pending,
    override: process.env["ALLOW_PENDING_MIGRATIONS"],
  });

  if (!verdict.blocked) {
    console.log(`\n  check:schema-deployed — ${verdict.reason}\n`);
    return;
  }

  console.error(`\n  Refusing to build production: ${verdict.reason}.\n`);
  console.error("  The code in this commit expects schema the database does not have.");
  console.error("  Building it would deploy 500s on every route that reads those tables,");
  console.error("  while the pages prerendered by this build kept serving and hid it.\n");
  console.error("  Apply them first, from a checkout that is up to date:\n");
  console.error("    git pull && pnpm db:deploy\n");
  console.error("  Then redeploy this commit from the Vercel dashboard.\n");
  console.error("  If a migration is pending on purpose — a DROP that has to land after the");
  console.error("  merge, per docs/deployments.md § Ordering — name every pending migration in");
  console.error("  ALLOW_PENDING_MIGRATIONS on this deployment.\n");
  process.exitCode = 1;
}

// Run the check when invoked directly; stay quiet when a test imports `decide`.
// Same shape as pending-migrations.mts, for the same reason.
if (process.argv[1]?.endsWith("check-schema-deployed.mts") === true) {
  await main();
}
