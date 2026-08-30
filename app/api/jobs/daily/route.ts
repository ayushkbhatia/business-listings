import { NextResponse, type NextRequest } from "next/server";
import { runDunning } from "@/lib/billing/dunning-job";
import { applyEndedCancellations } from "@/lib/billing/service";
import { pruneAttempts } from "@/lib/auth/attempts";
import { authorizeJob, runSteps } from "@/lib/jobs/authorize";

/**
 * The daily run — the three jobs whose natural grain is a day.
 *
 * Grouped into one route rather than three because Vercel's cron allowance is
 * small and these three are cheap, ordered and related: two of them read and
 * write the same `Subscription` rows, and the third is a `deleteMany`.
 *
 * None of these writes an audit row, and that is deliberate rather than an
 * omission. `AuditEvent.actorId` is NOT NULL because the log is a record of
 * *decisions*, and a platform following its own published sequence on a
 * schedule has no actor to attribute. The non-negotiable is about staff state
 * changes; a cron is not a member of staff. `lib/billing/dunning-job.ts` makes
 * the same argument at more length.
 *
 * Order matters. Dunning reads subscription state and may drop an account to
 * free; ending cancellations then applies the period-end moves. Running the
 * second first would let a subscription that ends today take a dunning step it
 * had already aged out of.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How much `auth_attempt` history to keep.
 *
 * This is a security parameter, not a tidiness one. `THROTTLES` in
 * `lib/auth/throttle.ts` counts `otp_request` and `reset_request` over a
 * sixty-minute window, so deleting rows newer than an hour hands an attacker a
 * throttle reset on request. Twenty-four hours leaves a wide margin over the
 * longest window and still stops the table growing without bound, which is what
 * it had been doing — 933 rows on a machine nobody had attacked.
 */
const KEEP_ATTEMPTS_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const refusal = authorizeJob(request, "daily");
  if (refusal) return refusal;

  const olderThan = new Date(Date.now() - KEEP_ATTEMPTS_MS);

  const outcome = await runSteps({
    dunning: () => runDunning(),
    endedCancellations: () => applyEndedCancellations(),
    async prunedAuthAttempts() {
      const pruned = await pruneAttempts(olderThan);
      return { pruned, olderThan };
    },
  });

  console.info("[jobs] daily", outcome.steps);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
}
