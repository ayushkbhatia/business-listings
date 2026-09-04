import "server-only";
import { resolveTarget } from "@/lib/db/target-url";

/**
 * Whether the /dev surfaces may render at all.
 *
 * There was no gate. `app/dev/gallery` and `app/dev/notifications` were built
 * as developer surfaces and shipped as public routes — prerendered, reachable
 * in production, kept out of search results by nothing stronger than a
 * `/dev` entry in `DISALLOWED_PATHS`. A robots directive is a request, not a
 * fence, and the gallery renders every component of the seller and staff
 * consoles with plausible data in it.
 *
 * Three conditions, and all three have to hold:
 *
 *   1. **The database is loopback.** This is the condition that carries the
 *      weight, and it is deliberately not `NODE_ENV`. `.env.local` in the repo
 *      root has pointed at the hosted Supabase before — lib/db/target.ts exists
 *      because of exactly that — and a dev surface that can seat you as the
 *      owner of a real supplier's listing is not a dev surface. On Vercel the
 *      pooler host is never loopback, so this alone closes production.
 *   2. Not `VERCEL_ENV=production`. Redundant with the first while the hosted
 *      database is hosted, and cheap: two independent reasons to refuse is the
 *      right number for a surface that grants a session.
 *   3. `DEV_SURFACES` is not explicitly `off`, so a developer working against a
 *      local database can still turn them off without editing code.
 *
 * `NODE_ENV` is deliberately **not** a condition. Playwright builds for
 * production and serves the suite with `pnpm build && pnpm start`, so
 * `NODE_ENV` is `production` for every browser test — including the one that
 * reads /dev/gallery. Gating on it would close the gallery to the only thing
 * that checks it renders.
 *
 * The seat page adds a fourth condition of its own: a service-role key, which
 * it needs and which nothing else on /dev does.
 */
export interface DevGate {
  allowed: boolean;
  /** Why not, in the words a developer needs. Empty when allowed. */
  refusals: string[];
  /** `127.0.0.1:54322/postgres`, for the banner. Never the password. */
  target: string;
}

export function devGate(env: NodeJS.ProcessEnv = process.env): DevGate {
  const refusals: string[] = [];

  if (env["VERCEL_ENV"] === "production") {
    refusals.push("This is the production deployment.");
  }

  const target = resolveTarget(env);
  if (!target) {
    refusals.push("Neither DIRECT_URL nor DATABASE_URL is set.");
  } else if (!target.isLoopback) {
    refusals.push(
      `The database is ${target.description}, which is not loopback. ` +
        `The dev surfaces only open against a throwaway.`,
    );
  }

  if (env["DEV_SURFACES"]?.trim().toLowerCase() === "off") {
    refusals.push("DEV_SURFACES is off.");
  }

  return {
    allowed: refusals.length === 0,
    refusals,
    target: target?.description ?? "no database",
  };
}
