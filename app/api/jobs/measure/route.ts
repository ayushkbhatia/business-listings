import { NextResponse, type NextRequest } from "next/server";
import { measureResponseTimes } from "@/lib/metrics/job";
import { measureProfileStrength } from "@/lib/metrics/strength-job";
import { pollDomains } from "@/lib/domains/service";
import { sweepAreaPages } from "@/lib/seo/area";
import { sweepAlerts } from "@/lib/alerts/service";
import { authorizeJob } from "@/lib/jobs/authorize";

/**
 * The scheduled measurement run.
 *
 * The `CRON_SECRET` check this route used to carry inline now lives in
 * `lib/jobs/authorize.ts`, because there are three job routes and the guard is
 * the only thing standing between them and the internet — one copy of that is
 * worth more than three that can drift.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const refusal = authorizeJob(request, "measure");
  if (refusal) return refusal;

  /*
   * Sequential, not parallel. Both write `Business.derivedAt` and running them
   * at once means two updates racing for the same row on every business that
   * changed in both. They take seconds; nothing is waiting on this.
   */
  const responseTimes = await measureResponseTimes();
  const profileStrength = await measureProfileStrength();

  /*
   * The domain poller rides along.
   *
   * Board 5e asks for a check every sixty seconds and this job runs on a longer
   * cadence, which is a real gap — a seller watching the screen sees `Waiting`
   * for longer than the board describes. It is here rather than nowhere, and
   * the honest fix is its own schedule once there is a certificate provider to
   * make verification mean something.
   *
   * It also writes no `Business` row, so unlike the two above it can run beside
   * them without racing for `derivedAt`.
   */
  const domains = await pollDomains();

  /*
   * Board 6a, criterion 1's second half. Rides along for the same reason the
   * domain poller does: it touches no `Business` row, so it cannot race the two
   * above for `derivedAt`.
   *
   * Bookkeeping rather than enforcement — `areaPageState.live` already refuses
   * to serve a page whose supply has dropped, and the sitemap re-checks. This
   * is what makes the stored column agree with what is being served.
   */
  const areaPages = await sweepAreaPages();

  /*
   * Criterion 8, and the end of the flywheel.
   *
   * Here rather than on product creation: a seller importing four hundred rows
   * would otherwise fire four hundred matches inside one request, and each
   * buyer would get whichever product happened to be first rather than the one
   * that matched best.
   */
  const alerts = await sweepAlerts();

  console.info("[jobs] measured", { responseTimes, profileStrength, domains, areaPages, alerts });
  return NextResponse.json({ responseTimes, profileStrength, domains, areaPages, alerts });
}
