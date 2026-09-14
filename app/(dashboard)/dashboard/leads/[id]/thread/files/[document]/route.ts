import { NextResponse } from "next/server";
import { sellerThreadAttachment } from "@/lib/messaging/service";
import { signedReadUrl } from "@/lib/storage";
import { getSellerSeat } from "../../../../../_shell";

/**
 * Board `10h` Q5 — a file sent in one thread, for the supplier on it.
 *
 *  1. **A seller seat.** Signed in, on a business.
 *  2. **That business's thread.** The document hangs off a message on this
 *     enquiry *and this business* — a seat at a competing supplier on the same
 *     enquiry gets the same answer as a document that does not exist.
 *  3. **A thread attachment**, and nothing else by a guessed id.
 *
 * A signed link good for two minutes, and a redirect. 404 for every refusal.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; document: string }> }) {
  const seat = await getSellerSeat();
  if (!seat) return new NextResponse(null, { status: 404 });

  const { id: enquiryId, document: documentId } = await params;
  const storagePath = await sellerThreadAttachment(seat.businessId, enquiryId, documentId);
  if (!storagePath) return new NextResponse(null, { status: 404 });

  const url = await signedReadUrl(storagePath, 120);
  if (!url) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
}
