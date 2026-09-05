import { NextResponse, type NextRequest } from "next/server";
import { deliverQueued, flushDeferred } from "@/lib/notify/service";
import { sweepAlerts } from "@/lib/alerts/service";
import { pollDomains } from "@/lib/domains/service";
import { sweepEscalations } from "@/lib/enquiry/escalation-job";
import { sweepFollowUps } from "@/lib/messaging/follow-up";
import { authorizeJob, runSteps } from "@/lib/jobs/authorize";

/**
 * The hourly sweep — the jobs whose value is in being timely, and whose cost
 * does not grow with the directory.
 *
 * Escalating unanswered enquiries, sending the follow-ups sellers armed,
 * releasing notifications held back for UAE quiet hours, matching saved buyer
 * alerts against newly listed products, and polling custom-domain DNS. Each
 * reads a bounded set — leads past their threshold, follow-ups due, deferred
 * deliveries, alerts not yet notified, domains awaiting verification — so this
 * run costs roughly the same at five thousand listings as at five hundred.
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

export async function GET(request: NextRequest) {
  const refusal = authorizeJob(request, "sweep");
  if (refusal) return refusal;

  const outcome = await runSteps({
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
    releasedNotifications: () => deliverQueued(),
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
       Board 5e asks for a check every sixty seconds and this is hourly, which
       is a real gap already — a seller who has just pointed their DNS watches
       "Waiting" for longer than the board describes. Daily would make that a
       day. Only businesses with a custom domain are read, and that is a paid
       feature, so the query is small however large the directory gets.
    */
    domains: () => pollDomains(),
  });

  console.info("[jobs] sweep", outcome.steps);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
}
