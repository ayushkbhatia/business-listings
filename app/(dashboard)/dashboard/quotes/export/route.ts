import { NextResponse, type NextRequest } from "next/server";
import { can } from "@/lib/auth/can";
import type { LeadScope } from "@/lib/leads/inbox";
import { exportPipeline } from "@/lib/quotes/export";
import { PIPELINE_TABS, type PipelineTab } from "@/lib/quotes/pipeline";
import { recordEvent } from "@/lib/telemetry/record";
import { getSellerSeat } from "../../_shell";

/**
 * Board 3k §9 — the pipeline as a file.
 *
 * A route rather than a server action, because the result is a download and an
 * action returns a value. It resolves the seat the same way every dashboard page
 * does, so a signed-out request gets the same nothing a page would.
 *
 * ## Scope is not a parameter
 *
 * The tab comes from the query string; the **scope does not**. A sales seat
 * exports their own assignments whatever the URL says, because §9 is explicit
 * that `staff` exports only what `staff` can see — and a scope a caller can set
 * is a scope a caller can widen.
 *
 * ## It contains prices
 *
 * Which makes it the seller's own commercial data: never a cross-seller
 * aggregate, never an admin view of line totals. Board 3j's rule is that a price
 * is private to one buyer and one seller, and a file is not an exception to it.
 * `Cache-Control: no-store` for the same reason — a CSV of one supplier's prices
 * has no business in a shared cache.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseTab(raw: string | null): PipelineTab {
  return (PIPELINE_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as PipelineTab)
    : "all";
}

export async function GET(request: NextRequest) {
  const seat = await getSellerSeat();
  if (!seat) return new NextResponse(null, { status: 404 });
  if (!can(seat.actor, "quote.send")) return new NextResponse(null, { status: 403 });

  const tab = parseTab(request.nextUrl.searchParams.get("tab"));
  const scope: LeadScope = can(seat.actor, "routing.manage")
    ? { kind: "all" }
    : { kind: "mine", userId: seat.actor.id };

  const file = await exportPipeline({ businessId: seat.businessId, tab, scope });

  await recordEvent({
    name: "pipeline_exported",
    businessId: seat.businessId,
    actorId: seat.actor.id,
    // Row count, so an export that produced nothing is visible as one rather
    // than as a seller who never tried.
    props: { tab, rows: file.rows },
  });

  return new NextResponse(file.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
