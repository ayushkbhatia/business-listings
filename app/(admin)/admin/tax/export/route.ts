import { NextResponse } from "next/server";
import { can } from "@/lib/auth/can";
import { getStaffSeat } from "@/lib/auth/staff";
import { exportFilename, toCsv, vatReturn } from "@/lib/billing/vat";
import { quarterFrom, quarterRange } from "../period";

/**
 * The download.
 *
 * A route rather than a server action returning a string, because the browser
 * has to save a file and an action cannot set `Content-Disposition`. The
 * capability is checked here as well as on the screen — a route handler is a
 * URL, and a URL somebody can paste is a URL somebody will paste.
 */

export async function GET(request: Request) {
  const seat = await getStaffSeat();
  if (!seat || !can(seat.actor, "revenue.read")) {
    // 404 rather than 403, the same as the console's pages. A 403 confirms the
    // endpoint exists to somebody who should not know it does.
    return new NextResponse(null, { status: 404 });
  }

  const requested = new URL(request.url).searchParams.get("period");
  const quarter = quarterFrom(requested);
  const { from, to } = quarterRange(quarter);

  const summary = await vatReturn(from, to);

  return new NextResponse(toCsv(summary), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(from)}"`,
      // Never cached. A VAT export is a snapshot of a period that is still
      // accruing until it closes, and a stale one is a wrong return.
      "cache-control": "no-store",
    },
  });
}
