import { NextResponse } from "next/server";
import { can } from "@/lib/auth/can";
import { getStaffSeat } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { signedReadUrl } from "@/lib/storage";

/**
 * The certificate behind a credential, for the person reviewing it — board
 * `4c-s` B9.
 *
 * Credential documents are private (`8b-s` B10): no public URL exists for one
 * and none is made here. Two locks and a short fuse, as for a claimant's
 * licence: a seat holding `queue.decide`, and a file that is this credential's
 * own. Then a two-minute signed link that is never cached.
 *
 * 404 for every refusal, never 403 — a refusal that confirms the file exists
 * has told somebody something.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const seat = await getStaffSeat();
  if (!seat || !can(seat.actor, "queue.decide")) return new NextResponse(null, { status: 404 });

  const { id } = await params;
  const credential = await prisma.credential.findUnique({
    where: { id },
    select: { document: { select: { storagePath: true } } },
  });
  if (!credential?.document) return new NextResponse(null, { status: 404 });

  const url = await signedReadUrl(credential.document.storagePath, 120);
  if (!url) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
}
