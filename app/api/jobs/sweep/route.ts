import { NextResponse, type NextRequest } from "next/server";
import { flushDeferred } from "@/lib/notify/service";
import { authorizeJob, runSteps } from "@/lib/jobs/authorize";

/**
 * The hourly sweep — everything that has to happen more often than once a day
 * and does not belong in the measurement run.
 *
 * Today that is one job: releasing notifications that were held back for UAE
 * quiet hours. It runs on its own schedule rather than riding along with
 * `measure`, because a metrics run that falls over should not also stop the
 * night's messages going out.
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
  });

  console.info("[jobs] sweep", outcome.steps);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
}
