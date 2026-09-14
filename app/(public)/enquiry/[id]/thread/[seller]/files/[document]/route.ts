import { NextResponse, type NextRequest } from "next/server";
import { buyerThreadAttachment } from "@/lib/messaging/service";
import { signedReadUrl } from "@/lib/storage";
import { resolveBuyerId } from "../../../../../_buyer";

/**
 * Board `10h` Q5 — a file sent in one thread, for the buyer on it.
 *
 * Three locks and a short fuse, as the seller's enquiry-attachment door has:
 *
 *  1. **The buyer.** Signed in, or holding their enquiry's claim token.
 *  2. **This thread.** The document hangs off a message on this enquiry and this
 *     supplier — not another supplier's thread on the same enquiry, which is
 *     the whole of Q5's second half.
 *  3. **A thread attachment.** Nothing else is reachable by guessing an id here.
 *
 * Then a signed link good for two minutes, and a redirect to it. 404 for every
 * refusal: a 403 tells somebody guessing ids which guesses were close.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; seller: string; document: string }> },
) {
  const { id, seller, document: documentId } = await context.params;
  const buyerId = await resolveBuyerId(request.nextUrl.searchParams.get("t"));
  if (!buyerId) return new NextResponse(null, { status: 404 });

  const storagePath = await buyerThreadAttachment(buyerId, id, seller, documentId);
  if (!storagePath) return new NextResponse(null, { status: 404 });

  const url = await signedReadUrl(storagePath, 120);
  if (!url) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
