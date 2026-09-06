// Next.js loads .env.local automatically; the Prisma CLI does not. Load it here
// so `prisma migrate` and `next dev` read the same connection strings.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";
import { resolveTarget } from "./lib/db/target-url";

loadEnv({ path: [".env.local", ".env"], quiet: true });

/*
   The Prisma CLI is the one destructive path in this repo that asserted
   nothing.

   `lib/db/target.ts` guards the seed, the integration suite and the end-to-end
   run, and its own comment describes this hazard exactly: the same command is a
   no-op against a throwaway and total data loss one directory up. It never
   covered `prisma migrate deploy`, `migrate dev`, `db push` or `db execute` —
   and every one of those reaches production from a shell with the wrong
   `.env.local` in it.

   It is not hypothetical. On 2026-09-06 a session applied two migrations to the
   hosted database by typing `pnpm exec prisma migrate deploy` out of habit, in a
   worktree whose `.env.local` named production rather than a throwaway. The
   review step — `pnpm db:deploy`, which prints every pending migration, names
   the target host and requires the word back — existed and was simply not the
   only way through. This makes it the only way through.

   `PRISMA_MIGRATE_REVIEWED` is set by `scripts/db-deploy.mts` for the one child
   process it spawns, after the operator has answered. `DB_DESTRUCTIVE_ALLOW_HOST`
   is the same escape hatch the other guards take, and is refused from a dotenv
   file for the same reason: an override living in `.env.local` is a guard that
   has been removed rather than passed.
*/
/**
 * The subcommands that reach the database with intent to change it.
 *
 * Not `generate`, `validate` or `format` — those read the schema file and never
 * connect, and blocking them would break the inner loop for anyone whose
 * `.env.local` names a remote, which is the ordinary setup for local
 * development against hosted Supabase. `migrate status` is left out for the
 * same reason: it reads.
 */
const WRITES = [
  ["migrate", "deploy"],
  ["migrate", "dev"],
  ["migrate", "reset"],
  ["migrate", "resolve"],
  ["db", "push"],
  ["db", "execute"],
  ["db", "seed"],
];

function isWrite(argv: readonly string[]): boolean {
  return WRITES.some(([group, action]) => {
    const at = argv.indexOf(group as string);
    return at !== -1 && argv.slice(at + 1).includes(action as string);
  });
}

function assertReviewedTarget(): void {
  if (!isWrite(process.argv)) return;

  // Null where neither URL is set — nothing to reach, nothing to refuse.
  const target = resolveTarget();
  if (!target || target.isLoopback) return;
  if (process.env["PRISMA_MIGRATE_REVIEWED"] === "1") return;
  if (process.env["DB_DESTRUCTIVE_ALLOW_HOST"] === target.host) return;

  throw new Error(
    `The Prisma CLI is about to write to ${target.host}, which is not a local database.\n\n` +
      `  Use \`pnpm db:deploy\`. It prints every pending migration, names the target and asks\n` +
      `  before it applies anything — which is the review this refusal exists to make unskippable.\n\n` +
      `  For a command db:deploy does not cover, name the host you are unlocking:\n` +
      `    DB_DESTRUCTIVE_ALLOW_HOST=${target.host} pnpm exec prisma <command>\n`,
  );
}

assertReviewedTarget();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // .mts, not .ts: package.json has no "type": "module", so tsx treats a bare
    // .ts as CJS and a top-level await in the seed throws TransformError.
    seed: "tsx prisma/seed.mts",
  },
  datasource: {
    // CLI only. Migrations and introspection need the session pooler (5432);
    // the transaction pooler the app runs on cannot execute DDL. The runtime
    // connection string is passed to PrismaClient in lib/db/client.ts.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
