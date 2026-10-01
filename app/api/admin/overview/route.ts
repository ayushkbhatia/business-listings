import { NextResponse } from "next/server";
import { getStaffSeat } from "@/lib/auth/staff";
import { platformOverview } from "@/lib/console/overview";

/**
 * Board 4a, Phase 2 — `GET /api/admin/overview?period=2026-09`.
 *
 * The overview's view, raw: the month's figures and the live block, each with
 * the link into the board that owns it (B1), so a client never builds a URL.
 * The same function the page renders from, filtered the same way — a seat
 * without `revenue.read` gets no MRR and no plan mix (B10), and a figure whose
 * board the seat cannot open has a null link rather than a link into a 404.
 *
 * Refused with the console's 404 for anybody who is not staff: a route handler
 * is a URL, and a URL gets pasted. Reading changes nothing, so nothing is
 * audited. `no-store`, because the live block is about now.
 *
 * `period` is `YYYY-MM`. Absent, it is the month in progress; malformed or in
 * the future, the last closed month — `4g`'s rule, through `periodFor`.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const seat = await getStaffSeat();
  if (!seat) return new NextResponse(null, { status: 404 });

  const period = new URL(request.url).searchParams.get("period");
  const { view, periods } = await platformOverview(seat.actor, period);

  return NextResponse.json(
    {
      ...view,
      periods: periods.map((month) => ({ key: month.key, partial: month.partial, from: month.from.toISOString() })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
