import { NextResponse, type NextRequest } from "next/server";
import { deliverQueued, flushDeferred } from "@/lib/notify/service";
import { sweepAlerts } from "@/lib/alerts/service";
import { sweepSavedSearches } from "@/lib/saved-search/service";
import { sweepEscalations } from "@/lib/enquiry/escalation-job";
import { sweepClosingEnquiries } from "@/lib/enquiry/closing-job";
import { sweepFollowUps } from "@/lib/messaging/follow-up";
import { authorizeJob, runSteps } from "@/lib/jobs/authorize";
import { retryRegisterReads } from "@/lib/credentials/review";

/**
 * The hourly sweep — the jobs whose value is in being timely, and whose cost
 * does not grow with the directory.
 *
 * Escalating unanswered enquiries, sending the follow-ups sellers armed,
 * releasing notifications held back for UAE quiet hours, and matching saved
 * buyer alerts against newly listed products. Each reads a bounded set — leads
 * past their threshold, follow-ups due, deferred deliveries, alerts not yet
 * notified — so this run costs roughly the same at five thousand listings as at
 * five hundred.
 *
 * A fifth step polled custom-domain DNS hourly until 9 Sep 2026. A seller's web
 * address is a label under our own zone now, so there is no record anywhere
 * that anybody has to wait for and nothing left to poll.
 *
 * The heading used to say "three of them" over a list that had grown to five.
 * A count written into prose beside a list that grows is a number that goes
 * wrong quietly, so this one no longer carries it — the same correction
 * `/api/jobs/daily` records having made.
 *
 * That is the line between this route and `/api/jobs/daily`. Everything that
 * walks the whole directory to recompute a number went there; everything a
 * person is waiting on stayed here.
 *
 * ## Releasing and sending are two steps
 *
 * `flushDeferred` claims the rows whose quiet-hours window has lifted and marks
 * them `queued`; `deliverQueued` hands them to a carrier. For a while only the
 * first half existed, nothing read `queued`, and a notification held overnight
 * moved from one waiting state to another and reached nobody.
 *
 * They stay two steps rather than being collapsed. A row that crashes between
 * the claim and the send is still `queued`, so the next run picks it up instead
 * of losing it — and two runs cannot send the same row twice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
   T6.6. The delivery loop's budget is measured against this, and a budget
   measured against an undeclared ceiling is guesswork: without it the function
   inherits the platform's default and the loop's sixty seconds could be longer
   than the run it is inside. Three hundred is this project's plan ceiling —
   `docs/deployments.md` § Which plan the crons run on — and the same number
   T4.6 declared on the importer for the same reason.
*/
export const maxDuration = 300;

/**
 * `flushDeferred` takes 200 rows a call. After a long quiet-hours window the
 * backlog is bigger than that, and an hourly job that clears 200 an hour would
 * never catch up on the morning after a holiday.
 *
 * So: loop until it returns nothing, bounded. 25 × 200 is 5,000 deliveries per
 * run, which is far more than a night in this market produces, and the bound
 * means a bug that stops the query draining cannot spin the function until it
 * times out.
 */
const MAX_PASSES = 25;

/**
 * How long the delivery loop may spend handing messages to carriers — T6.6.
 *
 * `deliverQueued` was called **once** a run, 200 rows a call, while the step
 * above it released up to 5,000: so the hourly ceiling on *releasing* a held
 * message was twenty-five times the ceiling on *sending* one, and the morning
 * after a long weekend the queue grew every hour instead of draining. Nothing
 * reported it, because `deliverQueued`'s own numbers were about the batch
 * rather than the backlog.
 *
 * A time budget rather than another pass count, because the two loops are
 * bounded by different things. `flushDeferred` is one `updateMany` a pass and
 * its cost is predictable; a delivery pass calls a carrier per row, and how
 * long 200 of those take is somebody else's network. Sixty seconds leaves the
 * rest of a 300-second run to the four steps that come after it, and the
 * remainder is still `queued` — which is a state the next run picks up rather
 * than a message lost.
 */
const DELIVERY_BUDGET_MS = 60_000;

export async function GET(request: NextRequest) {
  const refusal = await authorizeJob(request, "sweep");
  if (refusal) return refusal;

  const outcome = await runSteps("sweep", {
    /*
       First, because it is the one step somebody is waiting on. Board 8d's
       invite screen promises "anything unanswered for two hours escalates to
       you", and an escalation that arrives an hour late is an escalation about
       a reply time it has itself made worse.
    */
    escalations: () => sweepEscalations(),
    /*
       The other half of the same clock. The escalation sweep chases a seller who
       has not answered a buyer; this sends the one follow-up a seller armed for
       a buyer who has gone quiet after a quote.

       Second rather than first, and it matters: a lead that is about to escalate
       has no first reply, so it cannot have a follow-up armed — but running them
       in this order keeps the step somebody is waiting on at the front of the
       run whatever the queue looks like.
    */
    followUps: () => sweepFollowUps(),
    /*
       Board `1n`. A buyer whose quotes stop being acceptable within the day is
       told once. Hourly because a close is to the hour; bounded by enquiries
       closing in the next day, not by the directory. Quiet hours hold it like
       any other buyer message.
    */
    closingEnquiries: () => sweepClosingEnquiries(),
    async deferredNotifications() {
      let flushed = 0;
      let passes = 0;
      for (; passes < MAX_PASSES; passes += 1) {
        const moved = await flushDeferred();
        flushed += moved;
        if (moved === 0) break;
      }
      // `capped` says the backlog outran the bound, which is the number worth
      // seeing — the next run picks the rest up, but somebody should know.
      return { flushed, passes, capped: passes === MAX_PASSES };
    },
    /*
       After the claim, in the same run. A row released at :42 that waited for
       the next hour to be sent would spend an hour in a state whose whole
       purpose is to be transient.

       `unsendable` counts rows queued before the payload column existed, which
       have nothing to send and are marked failed rather than retried for ever.
    */
    async releasedNotifications() {
      const startedAt = Date.now();
      let sent = 0;
      let failed = 0;
      let unsendable = 0;
      let passes = 0;
      let overBudget = false;

      for (; passes < MAX_PASSES; passes += 1) {
        const batch = await deliverQueued();
        sent += batch.sent;
        failed += batch.failed;
        unsendable += batch.unsendable;
        // Nothing left to hand over: the queue is drained, which is the only
        // reason this loop should usually stop.
        if (batch.sent + batch.failed + batch.unsendable === 0) break;
        if (Date.now() - startedAt >= DELIVERY_BUDGET_MS) {
          overBudget = true;
          passes += 1;
          break;
        }
      }

      /*
         `capped` says the backlog outran the bound, which is the number worth
         seeing — the same thing `deferredNotifications` reports, and for the
         same reason: the next run picks the rest up and somebody should know
         that it had to.
      */
      return {
        sent,
        failed,
        unsendable,
        passes,
        capped: overBudget || passes === MAX_PASSES,
        ...(overBudget ? { stoppedBy: "time_budget" as const } : {}),
      };
    },
    /*
       Criterion 8, and the end of the flywheel: a search that found nothing
       becomes an enquiry when somebody finally lists the thing.

       Hourly because the latency is the product. A buyer who asked to be told
       when a part is listed, and hears about it a day later, has usually
       bought it somewhere else. It reads `productAlert where notifiedAt is
       null`, so it is bounded by outstanding alerts rather than by the size of
       the directory — it does not get more expensive as the platform grows,
       which is exactly why it stays on the short schedule while the two
       measurements did not.
    */
    alerts: () => sweepAlerts(),
    /*
       Board 4c-s. An FTA read the register did not answer is asked again, and a
       credential that now matches on all three is verified by the read — the
       machine settling what it can, so the queue holds only what it could not.
       Hourly because a seller is waiting on it; bounded by reads outstanding,
       not by the directory. With no register connected it returns at once.
    */
    registerReads: () => retryRegisterReads(),
    /*
       Board 10e — saved searches. Every hour, but each search is only looked at
       when its own cadence says: daily ones once a day, weekly ones once a week,
       and *when listed* ones every run, because that alert exists for the same
       reason the product alert above does. Bounded per run, oldest first.
    */
    savedSearches: () => sweepSavedSearches(),
  }, request);

  console.info("[jobs] sweep", outcome.steps);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
}
