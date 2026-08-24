import { config as loadEnv } from "dotenv";

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
