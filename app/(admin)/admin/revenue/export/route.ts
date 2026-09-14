import { NextResponse } from "next/server";
import { can } from "@/lib/auth/can";
import { getStaffSeat } from "@/lib/auth/staff";
import { revenueBoard } from "@/lib/billing/revenue-board";
import { revenueCsv, revenueExportFilename } from "@/lib/billing/revenue-export";
import { periodFor } from "@/lib/billing/revenue-period";

/**
 * Board 4g `B10` — the month, for finance.
 *
 * The same `revenueBoard` the page renders, for the same `period`, written out
 * with its formulas, its boundaries and every movement behind it. See
 * `lib/billing/revenue-export.ts` for the shape.
 *
 * `revenue.read` is checked here as well as on the page, and the refusal is a
 * 404 like the console's: a route handler is a URL, and a URL gets pasted.
 * Reading changes no state, so nothing is audited — the file records what it
 * is instead.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const seat = await getStaffSeat();
  if (!seat || !can(seat.actor, "revenue.read")) {
    return new NextResponse(null, { status: 404 });
  }

  const now = new Date();
  const period = periodFor(new URL(request.url).searchParams.get("period"), now);
  const board = await revenueBoard(period, now);

  return new NextResponse(revenueCsv(board, now), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${revenueExportFilename(board)}"`,
      // A month in progress changes by the minute, and a cached copy of one is
      // a wrong report with the right filename.
      "cache-control": "no-store",
    },
  });
}
