/**
 * Which database a destructive command is about to talk to, and whether it is
 * allowed to talk to it.
 *
 * Every destructive path in this repo finds its database the same way: read
 * `DIRECT_URL`, fall back to `DATABASE_URL`, connect. Nothing asks which host
 * that turned out to be. `prisma/seed.mts` opens with
 *
 *     truncate table "audit_event", "business", "review", … cascade;
 *
 * across 46 tables, and it will run that against whatever the environment
 * happened to name. On this project `.env.local` in the repo root points at the
 * hosted Supabase and `.env.local` inside a worktree points at a throwaway on
 * the laptop, so the same `pnpm db:seed` is a no-op in one directory and total
 * data loss one level up. There is no prompt and no undo.
 *
 * The code is in git and can be rebuilt in minutes. The data cannot: reviews
 * buyers wrote, enquiry and quote threads, which suppliers were verified and
 * when, who is paying. It exists once.
 *
 * So destructive commands assert their target first, and refuse anything that
 * is not loopback.
 *
 * **The override is deliberately awkward.** `DB_DESTRUCTIVE_ALLOW_HOST` must
 * name the exact host it is unlocking, so a value set for staging does not
 * silently cover production, and it is refused outright when it appears in
 * `.env.local` or `.env` — those are the files that point at production, and an
 * override living in one is a guard that has been removed rather than passed.
 * It has to be typed on the command line, every time, next to the thing it
 * permits.
 *
 * CI needs no override: `.github/workflows/ci.yml` runs against the
 * `supabase start` container on `127.0.0.1:54322`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readTarget, resolveTarget, type EnvLike, type Target } from "./target-url";

/** Set to the exact hostname being unlocked. Never valid from a dotenv file. */
export const OVERRIDE_VAR = "DB_DESTRUCTIVE_ALLOW_HOST";

/**
 * Loopback only.
 *
 * Not "anything that resolves to a private address" and not a `.local` suffix:
 * a tunnel, a VPN and a Docker bridge all put a production database behind an
 * address that looks harmless, and a guard that tries to be clever about which
 * ones are safe is a guard nobody can reason about. Four literals, and the
 * override for everything else.
 */
/*
   Re-exported, not redefined.

   The parse lives in `./target-url.ts`, which touches no filesystem, because
   `lib/dev/guard.ts` asks "is this loopback?" on a request and importing this
   module from a Server Component would pull `node:fs` and a runtime-resolved
   `readFileSync` into the app bundle. The same split `lib/trade/hours.ts` and
   `lib/catalogue-import/terms.ts` make, for the same reason.
*/
export { readTarget, resolveTarget, type EnvLike, type Target } from "./target-url";

/** The files a target may be read from, and the ones an override may not. */
const ENV_FILES = [".env.local", ".env"] as const;

/**
 * True when a dotenv file in the repo names the override.
 *
 * dotenv writes into `process.env`, so by the time a guard reads it there is no
 * way to tell a value typed on the command line from one committed to a file.
 * This reads the files themselves. Comments do not count; an empty assignment
 * does not either.
 */
function overrideInEnvFile(cwd: string): string | null {
  for (const name of ENV_FILES) {
    let contents: string;
    try {
      contents = readFileSync(join(cwd, name), "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) continue;
      const match = new RegExp(`^(?:export\\s+)?${OVERRIDE_VAR}\\s*=\\s*(.*)$`).exec(trimmed);
      if (match && match[1]!.replace(/^["']|["']$/g, "").trim() !== "") return name;
    }
  }
  return null;
}

export class NonLocalTargetError extends Error {
  constructor(
    message: string,
    readonly target: Target,
  ) {
    super(message);
    this.name = "NonLocalTargetError";
  }
}

export interface AssertOptions {
  env?: EnvLike;
  cwd?: string;
  /** Where the warning goes when an override is accepted. */
  warn?: (message: string) => void;
}

/**
 * Refuse to continue unless the database is loopback or explicitly unlocked.
 *
 * `operation` is what the caller is about to do, in the words a person would
 * use — "truncate every table and reseed", not "seed". The refusal quotes it
 * back, because the whole failure mode is not knowing what was about to happen.
 *
 * Returns the target so a caller can print it on the way through.
 */
export function assertLocalTarget(operation: string, options: AssertOptions = {}): Target {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const warn = options.warn ?? ((message: string) => console.warn(message));

  const target = resolveTarget(env);
  if (target === null) {
    throw new NonLocalTargetError(
      `Refusing to ${operation}: neither DIRECT_URL nor DATABASE_URL is set, ` +
        `so there is no way to know which database this would reach.`,
      readTarget(""),
    );
  }

  if (target.isLoopback) return target;

  const fromFile = overrideInEnvFile(cwd);
  if (fromFile !== null) {
    throw new NonLocalTargetError(
      `Refusing to ${operation} on ${target.description}.\n\n` +
        `  ${OVERRIDE_VAR} is set in ${fromFile}. It is only honoured from the command\n` +
        `  line, because an override in a dotenv file is a guard that has been removed\n` +
        `  rather than one that was passed — that file is what points at production.\n\n` +
        `  Remove it from ${fromFile}. If you meant this, type it next to the command:\n` +
        `    ${OVERRIDE_VAR}=${target.host} pnpm <command>\n`,
      target,
    );
  }

  const allowed = env[OVERRIDE_VAR];
  if (allowed === undefined || allowed === "") {
    throw new NonLocalTargetError(
      `Refusing to ${operation} on ${target.description}.\n\n` +
        `  That is not a local database. This would destroy or rewrite data that\n` +
        `  exists in exactly one place — reviews, enquiries, verification history,\n` +
        `  subscriptions — and there is no undo.\n\n` +
        `  If you are pointing at a throwaway, fix DIRECT_URL and DATABASE_URL:\n` +
        `    postgresql://postgres:postgres@127.0.0.1:54322/postgres\n\n` +
        `  If you genuinely meant ${target.host}, name it on the command line:\n` +
        `    ${OVERRIDE_VAR}=${target.host} pnpm <command>\n`,
      target,
    );
  }

  if (allowed !== target.host) {
    throw new NonLocalTargetError(
      `Refusing to ${operation} on ${target.description}.\n\n` +
        `  ${OVERRIDE_VAR} is set to ${allowed}, but the database is ${target.host}.\n` +
        `  The override names one host on purpose, so that unlocking staging cannot\n` +
        `  quietly unlock production. Check which one you meant.\n`,
      target,
    );
  }

  warn(
    `\n  ! ${operation} on ${target.description}, which is not local.\n` +
      `  ! Allowed by ${OVERRIDE_VAR}=${allowed}.\n`,
  );
  return target;
}
