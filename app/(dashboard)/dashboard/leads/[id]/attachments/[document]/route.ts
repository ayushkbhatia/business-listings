import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { signedReadUrl } from "@/lib/storage";
import { getSellerSeat } from "../../../../_shell";

/**
 * A buyer's file on an enquiry, for the seller it was sent to — board `1d-s`.
 *
 * `business-documents` is a private bucket and a buyer's trial balance is the
 * most private thing in it: a company's own numbers, handed to one firm to
 * quote on. So this is a door with three locks and a short fuse.
 *
 *  1. **A seller seat.** Signed in, on a business.
 *  2. **That business received this enquiry.** The same `EnquiryRecipient` row
 *     the lead screen itself 404s without. A seat on a firm the buyer did not
 *     write to gets the same answer as a document that does not exist.
 *  3. **The document is this enquiry's attachment.** Not a certificate, not a
 *     licence scan, not another enquiry's file under a guessed id.
 *
 * Then a signed link good for two minutes, minted at request time, and a
 * redirect to it — the file never passes through this function, and a link
 * copied out of the address bar is dead before it is useful to anyone else.
 *
 * 404 for every refusal, never 403: a 403 tells somebody guessing ids which
 * guesses were close.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; document: string }> },
) {
  const seat = await getSellerSeat();
  if (!seat) return new NextResponse(null, { status: 404 });

  const { id: enquiryId, document: documentId } = await params;

  const [recipient, document] = await Promise.all([
    prisma.enquiryRecipient.findUnique({
      where: { enquiryId_businessId: { enquiryId, businessId: seat.businessId } },
      select: { enquiryId: true },
    }),
    prisma.document.findFirst({
      where: { id: documentId, enquiryId, kind: "enquiry_attachment" },
      select: { storagePath: true },
    }),
  ]);
  if (!recipient || !document) return new NextResponse(null, { status: 404 });

  const url = await signedReadUrl(document.storagePath, 120);
  if (!url) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
}
