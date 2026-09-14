import { NextResponse, type NextRequest } from "next/server";
import { loadNegotiation } from "@/lib/messaging/negotiation-server";
import { compareRevision, revisionPairs } from "@/lib/messaging/negotiation";
import { revisionPdf } from "@/lib/quote/revision-pdf";
import { resolveBuyerId } from "../../../../../../_buyer";

/**
 * Board `10h` — one revision of one supplier's quote, as a PDF.
 *
 * The same gate as the thread, by the same loader: a route handler is exactly
 * the URL a page-level check would miss. Somebody else's enquiry, a supplier it
 * never went to, a draft and a revision that does not exist are one 404 with no
 * body. The figures are `compareRevision`'s, the thread table's own.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; seller: string; revision: string }> },
) {
  const { id, seller, revision } = await context.params;
  const buyerId = await resolveBuyerId(request.nextUrl.searchParams.get("t"));
  if (!buyerId) return new NextResponse(null, { status: 404 });

  const negotiation = await loadNegotiation(buyerId, id, seller);
  const number = Number(revision);
  if (!negotiation || !Number.isInteger(number)) return new NextResponse(null, { status: 404 });

  const pair = revisionPairs(negotiation.record.quotes).find((entry) => entry.quote.revision === number);
  // A proposal has no lines to set out; its record is the thread and, once accepted, `7c`.
  if (!pair || pair.quote.proposal) return new NextResponse(null, { status: 404 });

  const pdf = revisionPdf({
    supplierName: negotiation.supplier.displayName,
    enquiryRef: negotiation.enquiry.ref,
    quote: pair.quote,
    comparison: compareRevision(pair.quote, pair.previous, negotiation.record.requirement),
    now: new Date(),
  });

  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
      "Content-Length": String(pdf.bytes.byteLength),
      // Private to one buyer and regenerated per request, so nothing may keep it.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
