/**
 * Which database a connection string names — and nothing that touches a disk.
 *
 * Split out of `target.ts` because `lib/dev/guard.ts` asks this question on a
 * request. `target.ts` reads `.env.local` off the filesystem to catch an
 * override smuggled into a dotenv file, and importing it from a Server
 * Component pulls `node:fs` and a `readFileSync` on a computed path into the
 * app bundle — which the bundler warns about, correctly: a path resolved at
 * runtime cannot be traced, so it either bloats the deployment or is missing
 * from it.
 *
 * The guard needs the parse and not the audit. This is the parse.
 */

/**
 * Loopback only.
 *
 * Not "anything that resolves to a private address" and not a `.local` suffix:
 * a tunnel, a VPN and a Docker bridge all put a production database behind an
 * address that looks harmless, and a guard that tries to be clever about which
 * ones are safe is a guard nobody can reason about. Four literals, and an
 * override, in `target.ts`, for everything else.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

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
