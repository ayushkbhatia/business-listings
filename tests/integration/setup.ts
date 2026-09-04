import { config as loadEnv } from "dotenv";
import { assertLocalTarget } from "@/lib/db/target";

/**
 * Integration tests talk to a real Postgres.
 *
 * Locally that is the Supabase project in .env.local; in CI it is the
 * postgres:17 service the workflow starts, seeded by the same `pnpm db:seed`.
 * Nothing is mocked — the point of these is the parts a unit test cannot reach:
 * what Prisma actually selects, and what a transaction actually writes.
 */
loadEnv({ path: [".env.local", ".env"], quiet: true });

process.env.TZ = "Asia/Dubai";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Integration tests need DATABASE_URL. Set it in .env.local, or run `pnpm test:unit` for the suite that does not.",
  );
}

/*
   And it has to be a local one.

   These tests are not read-only. They create businesses and delete them by
   slug prefix, and `billing.test.ts` goes further: it resolves a real seeded
   supplier by slug, then changes its plan and its verification tier, deletes
   its subscription and empties its MRR ledger, restoring all of it in
   `afterAll` — which does not run if the suite dies partway. Against the hosted
   database that is a real supplier left on the wrong plan with its revenue
   history gone.

   `pnpm verify` runs this suite. That is the command CLAUDE.md tells everybody
   to run before opening a PR, so it is the likeliest of all of them to be typed
   in the wrong directory. See lib/db/target.ts.
*/
assertLocalTarget("run the integration suite, which deletes and rewrites rows");
