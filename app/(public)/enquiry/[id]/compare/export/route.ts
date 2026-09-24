import { NextResponse } from "next/server";
import { signInHref } from "@/lib/auth/next-path";
import { getQuoteComparison } from "@/lib/db/queries/quote-comparison";
import { buildComparison } from "@/lib/quote/comparison";
import { quoteComparisonCsv } from "@/lib/quote/comparison-export";
import { recordEvent } from "@/lib/telemetry/record";
import { resolveBuyerId } from "../../../_buyer";

/**
 * Board `1n` — *Export comparison*.
 *
 * The comparison the buyer is looking at, as a CSV, for the buyer and nobody
 * else: resolved exactly as the page is, so an unknown reference and somebody
 * else's enquiry are the same 404, and a visitor with neither a session nor a
 * working claim token is sent to sign in and back to the comparison.
 *
 * Personalised, so never cached anywhere between here and the buyer, and never
 * indexed. Arrival order, whatever the screen was sorted by — a file is a
 * record, and the record's order is the one the quotes came in.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("t");

  const buyerId = await resolveBuyerId(token);
  if (!buyerId) {
    return NextResponse.redirect(new URL(signInHref(`/enquiry/${encodeURIComponent(id)}/compare`), request.url));
  }

  const data = await getQuoteComparison(buyerId, id);
  if (!data) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const model = buildComparison(data.input, new Date());
  const { filename, csv } = quoteComparisonCsv(data, model);

  await recordEvent({
    name: "comparison_exported",
    actorId: buyerId,
    props: { quotes: model.quoted, lines: model.lines.length },
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
