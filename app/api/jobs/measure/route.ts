import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { measureResponseTimes } from "@/lib/metrics/job";

/**
 * The scheduled measurement run.
 *
 * Vercel Cron calls this with an `Authorization: Bearer $CRON_SECRET` header.
 * Anything else is refused: the job is idempotent and reads nothing private,
 * but an open endpoint that walks every recipient row is a free way to make
 * the database work for somebody.
 *
 * A missing secret refuses everything rather than allowing everything. A job
 * that silently stops running is better than one anybody can run.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env["CRON_SECRET"];
  if (!secret) {
    console.error("[jobs] measure called with no CRON_SECRET set");
    return new NextResponse(null, { status: 500 });
  }

  const offered = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!constantTimeEqual(offered, secret)) return new NextResponse(null, { status: 401 });

  const result = await measureResponseTimes();
  console.info("[jobs] response times measured", result);
  return NextResponse.json(result);
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Compare something of equal length anyway, so a wrong-length secret costs
    // the same as a wrong-value one.
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}
