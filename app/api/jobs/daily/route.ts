import { NextResponse, type NextRequest } from "next/server";
import { expireTrials } from "@/lib/billing/trial";
import { runRenewals } from "@/lib/billing/renewal-job";
import { runDunning } from "@/lib/billing/dunning-job";
import { applyEndedCancellations } from "@/lib/billing/service";
import { applyDueChanges } from "@/lib/billing/schedule";
import { writeMissingInvoicePdfs } from "@/lib/billing/pdf-backfill";
import { pruneAnalytics } from "@/lib/analytics/retention";
import { runPositionSnapshots } from "@/lib/analytics/snapshot-job";
import { pruneAttempts } from "@/lib/auth/attempts";
import { LONGEST_RATE_WINDOW_MS, pruneRateLimitHits } from "@/lib/rate-limit";
import { DRAFT_KEEP_DAYS, pruneDrafts } from "@/lib/onboarding/draft";
import { measureResponseTimes } from "@/lib/metrics/job";
import { measureProfileStrength } from "@/lib/metrics/strength-job";
import { sweepAreaPages } from "@/lib/seo/area";
import { sweepEmiratePages } from "@/lib/seo/emirate";
import { sweepCuratedLists } from "@/lib/seo/curated";
import { sweepExpiredLicences } from "@/lib/verification/expiry-job";
import { sweepExpiringLicences } from "@/lib/verification/licence-notice-job";
import { sweepZeroQuoteEnquiries } from "@/lib/enquiry/zero-quote";
import { pruneProductEvents } from "@/lib/telemetry/record";
import { expireInvites } from "@/lib/team/invite";
import { sweepSetupNudges } from "@/lib/setup/nudge-job";
import { sweepExpiringQuotes } from "@/lib/quotes/expiry-job";
import { sweepRamadanShift } from "@/lib/trade/ramadan-shift-job";
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
    /*
       Scheduled plan changes, last of the billing steps.

       Board 11f: a downgrade takes effect at the end of the period, so this is
       the step that makes the date on the button true. It runs after dunning and
       after ended cancellations because both can move the plan underneath a
       pending change — and a change that finds the account already on Free is
       applied anyway, to the plan the seller actually chose. The route they took
       to Free does not change what they asked for next.
    */
    scheduledChanges: () => applyDueChanges(),
    /*
       The invoices that have no document behind them, written again.

       Last of the billing steps, because every step above it can raise one.
       Board 11g made a failed PDF write recoverable rather than fatal — the
       invoice commits, the file is written after, and a failure leaves
       `pdfPath` null, which the screen reads and states. What it did not have
       was anything that tried again, or anything that said there was something
       to try: the failure went to a `console.warn` in a serverless function,
       which is a message with no reader. A storage outage during the nightly
       renewals therefore left that night's invoices undownloadable for good.

       `outstanding` in the result is the number an operator acts on.
    */
    invoicePdfs: () => writeMissingInvoicePdfs(),
    /*
       Board 3l's rollups, on a 90-day window — spec Q4.

       The same argument as the three prunes below: these grow with *traffic*
       rather than with sign-ups, and nothing else would ever delete from them.
       Unlike `auth_attempt` the cutoff is not a security parameter — nothing
       here identifies a person — it is how far back a seller's own screen can
       look. Sixty days is the floor for the page's 30-against-30 comparison to
       exist at all, so 90 is that plus a month of margin.
    */
    prunedAnalytics: () => pruneAnalytics(),
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
       The nightly position snapshot — the 3a/3l amendment's B1 and B2.

       **After all three of the steps above, and that is load-bearing.** It
       stores what the ranker saw, and the ranker reads `responseTimeMedianMs`,
       `specCompleteness` and `verificationTier` — the two measurements write the
       first two and the licence sweep writes the third. Running this first would
       archive yesterday's numbers under today's date every night, so a seller
       whose licence lapsed on Tuesday would be told on Wednesday that nothing
       about them had changed.

       Its position relative to `prunedAnalytics`, which runs earlier in this
       object, is immaterial: the cutoff is ninety days back and tonight's rows
       are never near it. Stated because "after the prune" looks like an
       ordering claim and is not one.

       Board 3l's counters stay where they are, on the render path. They count
       impressions, which only a real buyer generates; this counts position,
       which is true whether anybody looked or not. That is the whole point of
       the amendment and the reason the two are not one job.
    */
    positionSnapshots: () => runPositionSnapshots(),
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

       Board 6f gives it two more rules and a number to report. It takes a page
       down below the hysteresis band rather than below the publish floor, and
       it skips a page inside its minimum-live window — `heldByGrace` in the
       result, so a run that walks four hundred pages and takes none of them
       down can say whether that is because nothing fell or because the window
       caught them.
    */
    areaPages: () => sweepAreaPages(),
    /*
       The same bookkeeping for the 84 emirate pages, which had none.

       Both sweeps now also do board 6a's §Freshness work: recompute the supply
       digest for each published scope and move `content_updated_at` only where
       it actually changed. That is here rather than on the read path because
       the read path is the busiest public template in the product — a write per
       render, at `revalidate = 300`, with two crawlers racing for the same row.
    */
    emiratePages: () => sweepEmiratePages(),
    /*
       Board 6b §3. Live metrics against the snapshot each list publishes.

       It changes almost nothing on purpose: drift goes to a queue a person
       works, because the entries are hand-written and cross-reference each
       other, so reordering or dropping a member automatically would make the
       surrounding prose wrong. Two things do act — a lapsed licence, already
       suppressed in the build, and a list past its re-audit SLA with drift
       outstanding, which unpublishes rather than render a stale-data warning.

       After `expiredLicences`, and that ordering is load-bearing for the same
       reason `areaPages` is after it: this reads `verificationTier` to decide
       what has lapsed, and running it first would read tiers that step is about
       to invalidate.
    */
    curatedLists: () => sweepCuratedLists(),
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
    /*
       Board 3e §5's first two points, and it sits with the other two carriers
       for the same reason: it hands a message to one. Idempotent the same way —
       `sweepExpiringLicences` reads the delivery log and skips a business that
       has already had this stage's notice, so a retry caused by a step above it
       finds nothing to do.

       **After `expiredLicences`, and the order is load-bearing.** That step
       drops the tier on a licence that lapsed overnight; this one only ever
       looks forward, at licences that have not lapsed yet. Running it first
       would be harmless today and would stop being so the moment either
       function's window moved to touch the day itself — the two would then
       disagree about whether a licence expiring at midnight is a thing to warn
       about or a thing already done.
    */
    expiringLicences: () => sweepExpiringLicences(),
    /*
       Board 3d's Ramadan card promises the platform shifts its own estimated
       dates and emails the seller when they move. Fifth carrier in this route,
       and idempotent for the same reason as the other four — `sweepRamadanShift`
       compares the live window against `ramadan_dates_notified` and skips any
       business already told about this shift, so a retry finds nothing to do.

       A year the platform has not published before is *baselined* rather than
       announced: nothing has moved the first time a window appears, and mailing
       41,000 sellers to tell them Ramadan exists would be the job's own worst
       failure mode.
    */
    ramadanShift: () => sweepRamadanShift(),
  });

  console.info("[jobs] daily", outcome.steps);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
}
