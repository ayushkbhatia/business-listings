/**
 * Create the storage buckets, once, against a real Supabase project.
 *
 *   pnpm storage:setup
 *
 * Not a migration. `storage.*` belongs to Supabase, and CI runs a plain
 * Postgres with no storage schema — a migration touching it would fail every
 * build for a feature CI cannot exercise anyway. Idempotent, so running it
 * again after adding a bucket is safe.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

const { ensureBuckets } = await import("../lib/storage/index.js");

const result = await ensureBuckets();
if (result.created.length > 0) console.log(`created: ${result.created.join(", ")}`);
if (result.existing.length > 0) console.log(`already there: ${result.existing.join(", ")}`);
if (result.created.length === 0 && result.existing.length === 0) {
  console.log("no buckets created and none found — check SUPABASE_SECRET_KEY");
}
process.exit(0);
