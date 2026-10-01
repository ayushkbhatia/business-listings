import { NextResponse } from "next/server";
import { z } from "zod";
import { getStaffSeat } from "@/lib/auth/staff";
import { isFigureKey } from "@/lib/console/overview-view";
import { recordEvent } from "@/lib/telemetry/record";

/**
 * Board 4a, Phase 5 — a figure on the overview was followed.
 *
 * The beacon `OverviewLink` posts on click. Staff-only, and the seat is read
 * from the session rather than the body; the figure must be one of the
 * overview's own keys and the period a month. Anything else is dropped. It
 * always answers 204, like `/api/events`: a beacon cannot read a status, and an
 * error would only teach a client to retry a moment that has passed.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  figure: z.string().max(64),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

/** A key and a month is a few dozen bytes. */
const MAX_BODY_BYTES = 512;

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  const seat = await getStaffSeat();
  if (!seat) return noContent();

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return noContent();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return noContent();
  }
  const body = bodySchema.safeParse(parsed);
  if (!body.success || !isFigureKey(body.data.figure)) return noContent();

  await recordEvent({
    name: "overview_figure_opened",
    actorId: seat.actor.id,
    props: { figure: body.data.figure, period: body.data.period },
  });
  return noContent();
}
