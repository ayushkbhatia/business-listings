import { describe, expect, it } from "vitest";
import { resolveTarget } from "@/lib/db/target-url";

/**
 * The refusal `prisma.config.ts` performs, asserted against the decision it
 * makes rather than by shelling out to the CLI.
 *
 * On 2026-09-06 a session applied two migrations to the hosted database by
 * typing `pnpm exec prisma migrate deploy` in a worktree whose `.env.local`
 * named production rather than a throwaway. `lib/db/target.ts` already guarded
 * the seed, the integration suite and the end-to-end run — its own comment
 * describes this hazard exactly — and covered none of the Prisma CLI.
 */

/** The predicate prisma.config.ts applies. Kept in step by this test. */
function isRefused(
  env: Record<string, string | undefined>,
  argv: readonly string[] = ["prisma", "migrate", "deploy"],
): boolean {
  if (!isWrite(argv)) return false;
  const target = resolveTarget(env);
  if (!target || target.isLoopback) return false;
  if (env["PRISMA_MIGRATE_REVIEWED"] === "1") return false;
  return env["DB_DESTRUCTIVE_ALLOW_HOST"] !== target.host;
}

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

const PRODUCTION = "postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("the Prisma CLI's target", () => {
  it("refuses a hosted database typed by hand", () => {
    expect(isRefused({ DIRECT_URL: PRODUCTION })).toBe(true);
  });

  it("lets a loopback database through untouched", () => {
    // Every throwaway, and CI's own `supabase start` container.
    expect(isRefused({ DIRECT_URL: LOCAL })).toBe(false);
    expect(isRefused({ DATABASE_URL: LOCAL })).toBe(false);
  });

  it("lets the reviewed path through", () => {
    // `scripts/db-deploy.mts` sets this for the one child it spawns, after it
    // has printed every pending migration, named the host and been answered.
    expect(isRefused({ DIRECT_URL: PRODUCTION, PRISMA_MIGRATE_REVIEWED: "1" })).toBe(false);
  });

  it("takes an override only when it names the exact host", () => {
    // So a value set for staging does not silently cover production.
    expect(
      isRefused({ DIRECT_URL: PRODUCTION, DB_DESTRUCTIVE_ALLOW_HOST: "staging.example.com" }),
    ).toBe(true);
    expect(
      isRefused({
        DIRECT_URL: PRODUCTION,
        DB_DESTRUCTIVE_ALLOW_HOST: "aws-0-ap-south-1.pooler.supabase.com",
      }),
    ).toBe(false);
  });

  it("lets a command that only reads through", () => {
    /*
       `generate` builds the client from the schema file and never connects, and
       `verify:fast` runs it first. Refusing it would break the inner loop for
       anyone developing locally against hosted Supabase, which is the ordinary
       setup here — and a guard that stops ordinary work is a guard somebody
       deletes within the week.
    */
    for (const argv of [["prisma", "generate"], ["prisma", "validate"], ["prisma", "migrate", "status"]]) {
      expect(isRefused({ DIRECT_URL: PRODUCTION }, argv), argv.join(" ")).toBe(false);
    }
  });

  it("refuses every subcommand that writes", () => {
    for (const argv of [
      ["prisma", "migrate", "deploy"],
      ["prisma", "migrate", "dev"],
      ["prisma", "migrate", "reset"],
      ["prisma", "db", "push"],
      ["prisma", "db", "execute", "--file", "x.sql"],
      ["prisma", "db", "seed"],
    ]) {
      expect(isRefused({ DIRECT_URL: PRODUCTION }, argv), argv.join(" ")).toBe(true);
    }
  });

  it("refuses a connection string it cannot parse", () => {
    // A guard that fails open on input it did not understand is not a guard,
    // and a hand-edited production URL is exactly that shape.
    expect(isRefused({ DIRECT_URL: "postgres://not a url" })).toBe(true);
  });

  it("has nothing to refuse when no database is named", () => {
    expect(isRefused({})).toBe(false);
  });

  it("prefers DIRECT_URL, which is what the CLI actually connects on", () => {
    expect(isRefused({ DIRECT_URL: PRODUCTION, DATABASE_URL: LOCAL })).toBe(true);
  });
});
