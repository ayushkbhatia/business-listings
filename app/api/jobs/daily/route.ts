import { NextResponse, type NextRequest } from "next/server";
import { expireTrials } from "@/lib/billing/trial";
import { runRenewals } from "@/lib/billing/renewal-job";
import { runDunning } from "@/lib/billing/dunning-job";
import { applyEndedCancellations } from "@/lib/billing/service";
import { pruneAttempts } from "@/lib/auth/attempts";
import { LONGEST_RATE_WINDOW_MS, pruneRateLimitHits } from "@/lib/rate-limit";
import { DRAFT_KEEP_DAYS, pruneDrafts } from "@/lib/onboarding/draft";
import { measureResponseTimes } from "@/lib/metrics/job";
import { measureProfileStrength } from "@/lib/metrics/strength-job";
import { sweepAreaPages } from "@/lib/seo/area";
import { sweepExpiredLicences } from "@/lib/verification/expiry-job";
import { sweepZeroQuoteEnquiries } from "@/lib/enquiry/zero-quote";
import { pruneProductEvents } from "@/lib/telemetry/record";
import { expireInvites } from "@/lib/team/invite";
import { sweepSetupNudges } from "@/lib/setup/nudge-job";
import { sweepExpiringQuotes } from "@/lib/quotes/expiry-job";
import { authorizeJob, runSteps } from "@/lib/jobs/authorize";

/**
 * The daily run — the jobs whose natural grain is a day.
 *
 * Grouped into one route rather than one route each because Vercel's cron
 * allowance is small and these are cheap, ordered and related: several read and
 * write the same `Subscription` rows, several are a `deleteMany`, and each step
 * whose position matters says so where it sits.
 *
 * The heading said "the three jobs" for a while, over a list that had long
 * stopped being three. A count written into prose beside a list that grows is a
 * number that goes wrong quietly, so this one no longer carries it.
 *
 * None of these writes an audit row, and that is deliberate rather than an
 * omission. `AuditEvent.actorId` is NOT NULL because the log is a record of
 * *decisions*, and a platform following its own published sequence on a
 * schedule has no actor to attribute. The non-negotiable is about staff state
 * changes; a cron is not a member of staff. `lib/billing/dunning-job.ts` makes
 * the same argument at more length.
 *
 * Order matters. Renewals run first: a payment that fails today has to be
 * marked past due before dunning reads the row, or the D0 retry waits a day and
 * the whole fourteen-day sequence starts late for everybody. Dunning then reads
 * subscription state and may drop an account to free; ending cancellations
 * applies the period-end moves last. Running that second first would let a
 * subscription that ends today take a dunning step it had already aged out of.
 *
 * With no payment gateway configured, `runRenewals` charges nothing, moves no
 * date and marks nobody past due — it reports `skippedNoProvider` and leaves the
 * rows alone. Anything else would either advance every renewal without taking
 * money or march every subscription in staging into dunning inside a fortnight.
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

/** How many of the longest rate-limit window to keep. Margin, not tidiness. */
const RATE_HIT_MARGIN = 12;

/**
 * How much `product_event` history to keep.
 *
 * The table exists to answer board 8a's question — *what score are sellers at
 * when they give up* — and that is a cohort question: a supplier's setup runs
 * over weeks, so a window has to hold several of them side by side before it
 * says anything. Two quarters does. Beyond that these are rows that grow with
 * traffic and that nothing renders, which is the same argument the two prunes
 * above make one table over.
 */
const KEEP_PRODUCT_EVENTS_DAYS = 180;

export async function GET(request: NextRequest) {
  const refusal = authorizeJob(request, "daily");
  if (refusal) return refusal;

  const olderThan = new Date(Date.now() - KEEP_ATTEMPTS_MS);

  const outcome = await runSteps({
    /*
       Trials first. A fortnight that ran out today has to be off Pro before
       anything else reads the row: a trial carries a `renewsAt` equal to its own
       end, and renewals running first would find a period that looks due. It
       takes no card, so there is nothing to charge — it drops to Free and hides
       what the Free cap has no room for.
    */
    expiredTrials: () => expireTrials(),
    renewals: () => runRenewals(),
    dunning: () => runDunning(),
    endedCancellations: () => applyEndedCancellations(),
    async prunedAuthAttempts() {
      const pruned = await pruneAttempts(olderThan);
      return { pruned, olderThan };
    },
    /*
       The same argument as the line above, one table over.

       `rate_limit_hit` counts board 2a's unauthenticated search, so it grows
       with traffic rather than with sign-ins, and nothing else would ever
       delete from it. The cutoff is a security parameter for the same reason:
       pruning inside the longest window in `RATE_POLICIES` hands back an
       allowance somebody has already spent. A generous multiple of that window
       leaves margin and still keeps the table bounded.
    */
    async prunedRateLimitHits() {
      const cutoff = new Date(Date.now() - RATE_HIT_MARGIN * LONGEST_RATE_WINDOW_MS);
      const pruned = await pruneRateLimitHits(cutoff);
      return { pruned, olderThan: cutoff };
    },
    /*
       Board 8a's telemetry, on the same argument as the two prunes above.

       `product_event` is written by `/api/events` on every setup screen, so it
       grows with traffic rather than with sign-ups, and nothing else would ever
       delete from it. Unlike those two the cutoff is not a security parameter —
       it is how far back the funnel is worth reading. See the constant.
    */
    async prunedProductEvents() {
      const cutoff = new Date(Date.now() - KEEP_PRODUCT_EVENTS_DAYS * 24 * 60 * 60 * 1000);
      const pruned = await pruneProductEvents(cutoff);
      return { pruned, olderThan: cutoff };
    },
    /*
       And board 2b's half-finished forms.

       `onboarding_draft` holds what a supplier typed before going to find their
       trade licence. Ninety days rather than the fortnight the board names as
       typical: a cutoff at the typical case deletes the slow half of it, and the
       slow half is exactly who this feature is for.
    */
    async prunedOnboardingDrafts() {
      const cutoff = new Date(Date.now() - DRAFT_KEEP_DAYS * 24 * 60 * 60 * 1000);
      const pruned = await pruneDrafts(cutoff);
      return { pruned, olderThan: cutoff };
    },
    /*
       The two measurements, moved here off an hourly schedule.

       Both walk the whole directory and write a row per business:
       `measureProfileStrength` reads every unsuspended business plus every
       product, every media row and every spec field, then issues one UPDATE
       each. At a few hundred listings that is nothing. At a few thousand it is
       four full scans and a few thousand writes, twenty-four times a day, for
       numbers that move on the timescale of a seller editing their profile.

       Nothing reads them urgently. A median reply time and a completeness
       percentage that are a day old are still true enough to rank and to show,
       and both are recomputed from source rather than accumulated — so a
       skipped run costs freshness and never correctness.

       Sequential, and in this order, because both write `Business.derivedAt`
       and running them together means two updates racing for the same row on
       every business that changed in both.
    */
    responseTimes: () => measureResponseTimes(),
    profileStrength: () => measureProfileStrength(),
    /*
       The tier drop the schema has promised since handoff 1.

       Before `areaPages`, and that ordering is load-bearing: `sweepAreaPages`
       counts verified suppliers with `verificationTier >= VERIFIED_TIER` to
       decide whether an area page clears its publish floor. Run it first and
       the floors are computed from tiers this step is about to invalidate — an
       area page held open by a supplier whose licence lapsed last night.

       Also before the two measurements is not required and would not help:
       neither reads the tier.
    */
    expiredLicences: () => sweepExpiredLicences(),
    /*
       Board 1i criterion 14. An enquiry that closed with nothing back is a
       supply signal, and it is written here rather than when a buyer opens the
       page — a render is the wrong place to write a business record, because
       an enquiry nobody revisits would never be counted and one somebody
       refreshes would be counted every time they looked.
    */
    zeroQuoteEnquiries: () => sweepZeroQuoteEnquiries(),
    /*
       Bookkeeping, not enforcement, which is why it can wait a day:
       `areaPageState.live` recomputes the publish floors at read time, so a
       page whose supply has dropped stops being indexable in the same request.
       This only makes the stored column agree with what is already served.
    */
    areaPages: () => sweepAreaPages(),
    /*
       Team invitations that have run out of time.

       The same kind of job as the licence sweep — something lapses on a date
       and the row has to catch up with the calendar — but with nothing reading
       it, so it does not have to run before anything. An invitation nobody
       accepted is not a seat: profile strength counts users, and an expired
       invite was never one.
    */
    expiredInvites: () => expireInvites(new Date()),
    /*
       Board 8a's one nudge, and it runs last on purpose.

       Every step above it is a database write that a retry repeats harmlessly.
       This one hands a message to a carrier, and a WhatsApp cannot be taken
       back. `runSteps` reports 500 when any step failed and Vercel retries the
       whole batch, so a nudge placed early would be re-entered on every retry
       caused by a step that has nothing to do with it — with only its own guard
       between the supplier and a second reminder. Last, the guard is the belt
       and the ordering is the braces.

       Idempotent all the same: `sweepSetupNudges` skips any business that
       already has a `setup_nudge` delivery row, so the retry finds nothing to
       do rather than being trusted not to run.
    */
    setupNudges: () => sweepSetupNudges(),
    /*
       Board 7e §2's added row, and it sits beside the nudge for the same
       reason: it hands a message to a carrier. Idempotent the same way —
       `sweepExpiringQuotes` skips any quote that already has a `quote_expiring`
       delivery row, so a retry caused by a step above it finds nothing to do.
    */
    expiringQuotes: () => sweepExpiringQuotes(),
  });

  console.info("[jobs] daily", outcome.steps);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
}
