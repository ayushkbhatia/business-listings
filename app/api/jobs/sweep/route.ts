import { NextResponse, type NextRequest } from "next/server";
import { flushDeferred } from "@/lib/notify/service";
import { sweepAlerts } from "@/lib/alerts/service";
import { pollDomains } from "@/lib/domains/service";
import { authorizeJob, runSteps } from "@/lib/jobs/authorize";

/**
 * The hourly sweep — the jobs whose value is in being timely, and whose cost
 * does not grow with the directory.
 *
 * Three of them: releasing notifications held back for UAE quiet hours,
 * matching saved buyer alerts against newly listed products, and polling
 * custom-domain DNS. Each reads a bounded set — deferred deliveries, alerts
 * not yet notified, domains awaiting verification — so this run costs roughly
 * the same at five thousand listings as at five hundred.
 *
 * That is the line between this route and `/api/jobs/daily`. Everything that
 * walks the whole directory to recompute a number went there; everything a
 * person is waiting on stayed here.
 *
 * ## What this does not fix
 *
 * `flushDeferred` moves a delivery from `deferred` to `queued`. **Nothing in
 * this codebase reads `queued`.** There is no carrier hand-off yet, so a row
 * this job releases still does not reach anybody's phone — it moves from one
 * waiting state to another.
 *
 * Scheduling it is necessary and not sufficient, and it is written down here
 * rather than left for somebody to discover, because a cron entry against a
 * job named "flush" reads like the gap is closed. It is not.
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
