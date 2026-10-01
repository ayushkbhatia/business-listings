import { NextResponse } from "next/server";
import { can } from "@/lib/auth/can";
import { getStaffSeat } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { signedReadUrl } from "@/lib/storage";

/**
 * The licence a claimant uploaded, for the person deciding the claim — board 4b.
 *
 * The board's thesis is that the rows a machine could not settle "need a person
 * to look at a document", and until now no staff screen could open one: the
 * conflict page printed the filename and stopped. Two locks and a short fuse,
 * like the seller's own attachment route: a seat holding `queue.decide`, and a
 * document that is this claim's own evidence. Then a two-minute signed link.
 *
 * 404 for every refusal, never 403.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const seat = await getStaffSeat();
  if (!seat || !can(seat.actor, "queue.decide")) return new NextResponse(null, { status: 404 });

  const { id } = await params;
  /*
     Board 4c Q4: `?file=tenancy` is the tenancy contract a claimant uploaded
     when an ops lead asked every side of a conflict for one. Private on the
     same terms as the licence (`B16`): this route, this seat, two minutes.
  */
  const tenancy = new URL(request.url).searchParams.get("file") === "tenancy";
  const claim = await prisma.claimSubmission.findUnique({
    where: { id },
    select: { document: { select: { storagePath: true } }, tenancyDocument: { select: { storagePath: true } } },
  });
  const file = tenancy ? claim?.tenancyDocument : claim?.document;
  if (!file) return new NextResponse(null, { status: 404 });

  const url = await signedReadUrl(file.storagePath, 120);
  if (!url) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
}
