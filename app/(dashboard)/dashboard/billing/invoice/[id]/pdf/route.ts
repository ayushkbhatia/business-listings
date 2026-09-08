import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { mayManageBilling } from "@/lib/auth/guards";
import { readInvoicePdf } from "@/lib/storage";
import { getSellerSeat } from "../../../../_shell";

/**
 * The stored PDF, served byte for byte.
 *
 * Board 11g, criterion 7: *"the PDF served is the file written at issue, byte
 * for byte."* This route reads storage and streams what it finds. It does not
 * render, and there is deliberately no fallback that would: a PDF produced by a
 * later version of the template is a different document from the one the seller
 * filed with their accountant, even when every figure on it matches.
 *
 * So a missing file is a 404, not a regeneration. The screen already knows —
 * `pdfPath` is null there too — and says the download is unavailable rather than
 * offering one.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const seat = await getSellerSeat();
  if (!seat) return new NextResponse(null, { status: 404 });
  // Owner and finance, by URL as well as by navigation — criterion 11. A route
  // handler is exactly the URL a nav-level check would miss.
  if (!mayManageBilling(seat.actor)) return new NextResponse(null, { status: 404 });

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, ref: true, businessId: true, pdfPath: true, status: true },
  });

  if (!invoice || invoice.businessId !== seat.businessId) {
    return new NextResponse(null, { status: 404 });
  }
  if (invoice.status === "draft" || !invoice.pdfPath) {
    return new NextResponse(null, { status: 404 });
  }

  const bytes = await readInvoicePdf(invoice.pdfPath);
  if (!bytes) return new NextResponse(null, { status: 404 });

  /*
     The delivery log, before the bytes go out.

     Accounting teams ask who downloaded an invoice and when, and the record has
     to exist before the question is asked rather than being reconstructed from a
     web log. Awaited rather than fired and forgotten: a serverless function that
     returns before its write lands is a write that sometimes does not happen.
  */
  await prisma.invoiceEvent.create({
    data: { invoiceId: invoice.id, kind: "downloaded", actorId: seat.actor.id },
  });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // `inline`, so a seller who clicks it reads it rather than finding it in a
      // downloads folder. The filename still applies when they do save it.
      "Content-Disposition": `inline; filename="${invoice.ref}.pdf"`,
      "Content-Length": String(bytes.byteLength),
      // The file never changes, and that is the whole promise. It is also
      // private: a shared cache holding one seller's invoice would be a leak.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
