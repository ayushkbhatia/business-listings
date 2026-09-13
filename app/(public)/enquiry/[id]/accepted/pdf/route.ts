import { NextResponse, type NextRequest } from "next/server";
import { getAcceptedRecord } from "@/lib/db/queries/accepted-record";
import { acceptedQuotePdf } from "@/lib/quote/record-pdf";
import { resolveBuyerId } from "../../../_buyer";

/**
 * Board `7c` `B7` — *Download quote PDF*.
 *
 * Rendered from the same `AcceptedRecord` the page renders, on every request.
 * `lib/quote/record-pdf.ts` says why this one is not stored the way a tax
 * invoice is: the record can still gain the buyer's reference, and a stored
 * copy would stop matching the page the moment it did.
 *
 * The same gate as the page, by the same loader — a route handler is exactly the
 * URL a page-level check would miss. Somebody else's enquiry, an unaccepted one
 * and a missing one are one 404 with no body.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext<"/enquiry/[id]/accepted/pdf">) {
  const { id } = await context.params;
  const token = request.nextUrl.searchParams.get("t");

  const buyerId = await resolveBuyerId(token);
  if (!buyerId) return new NextResponse(null, { status: 404 });

  const record = await getAcceptedRecord(buyerId, id);
  if (!record) return new NextResponse(null, { status: 404 });

  const pdf = acceptedQuotePdf(record, new Date());

  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // `attachment`: the control says *Download*, and a buyer forwarding it to
      // an accounts team wants the file rather than a browser tab.
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
      "Content-Length": String(pdf.bytes.byteLength),
      // Private to one buyer and regenerated per request, so nothing may keep it.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
