/**
 * Create the storage buckets, once, against a real Supabase project.
 *
 *   pnpm storage:setup
 *
 * Not a migration. `storage.*` belongs to Supabase, and CI runs a plain
 * Postgres with no storage schema — a migration touching it would fail every
 * build for a feature CI cannot exercise anyway. Idempotent, so running it
 * again after adding a bucket is safe — and running it after changing a size
 * limit is how an existing bucket learns the new one.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

const { ensureBuckets } = await import("../lib/storage/index.js");

const result = await ensureBuckets();
if (result.created.length > 0) console.log(`created: ${result.created.join(", ")}`);
/*
   "reconciled" rather than "already there": the script now pushes the current
   size limit and mime list onto a bucket that exists, because a ceiling that
   only applied to environments created after the change is not a ceiling.
*/
if (result.updated.length > 0) console.log(`reconciled: ${result.updated.join(", ")}`);
if (result.created.length === 0 && result.updated.length === 0) {
  console.log("no buckets created or reconciled — check SUPABASE_SECRET_KEY");
}
process.exit(0);
