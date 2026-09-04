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
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** The files a target may be read from, and the ones an override may not. */
const ENV_FILES = [".env.local", ".env"] as const;

export interface Target {
  /*
     Deliberately no `url`.

     A connection string carries the password, and an error object that holds
     one gets printed in full by any handler that logs the error rather than its
     message — which is what `prisma/seed.mts` did, so the first run of this
     guard printed the production password to the terminal. Nothing downstream
     needs the string: the guard reports, it does not connect.
  */
  host: string;
  port: string;
  database: string;
  /** `127.0.0.1:54322/postgres` — what a message prints. Never the password. */
  description: string;
  isLoopback: boolean;
}

/**
 * Parse a connection string into the parts a refusal needs to name.
 *
 * An unparseable string is **not** treated as local. A guard that fails open on
 * input it did not understand is not a guard, and `postgres://…` with a stray
 * character is exactly the shape of a hand-edited production URL.
 */
export function readTarget(url: string): Target {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      host: "",
      port: "",
      database: "",
      description: "an unparseable connection string",
      isLoopback: false,
    };
  }

  // `new URL` keeps the brackets on an IPv6 literal; the set holds the address.
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const port = parsed.port || "5432";
  const database = parsed.pathname.replace(/^\//, "");

  return {
    host,
    port,
    database,
    description: `${host}:${port}/${database}`,
    isLoopback: LOOPBACK.has(host),
  };
}

/**
 * The two variables this module reads, and nothing else.
 *
 * Not `NodeJS.ProcessEnv`: this repo declares that type with a required
 * `NODE_ENV`, so every caller and every test would have to supply one to ask a
 * question about a connection string. `process.env` satisfies this.
 */
export type EnvLike = Record<string, string | undefined>;

/** What `DIRECT_URL` / `DATABASE_URL` currently name, or null if neither is set. */
export function resolveTarget(env: EnvLike = process.env): Target | null {
  const url = env["DIRECT_URL"] ?? env["DATABASE_URL"];
  if (url === undefined || url === "") return null;
  return readTarget(url);
}

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
