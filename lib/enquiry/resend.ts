import "server-only";
import { prisma } from "@/lib/db/client";
import { enquiryTrade } from "./tracking";

/**
 * Board 10e `B3` — re-sending an enquiry that expired.
 *
 * Expired is terminal. Re-send never revives the old row, never extends its
 * close and never edits it: it opens the composer with the old requirement in
 * it, and sending creates a **new** enquiry whose `resentFromId` points back.
 *
 * **The match runs again (Q4, our position).** The expired row went to suppliers
 * who let it lapse; re-sending to the same list is the wrong default. So the
 * lines come across as free text — never pinned to the products, and so never to
 * the sellers, they were matched to — and the composer's own matcher picks the
 * recipients for the trade the enquiry was in.
 *
 * Signed-in only. A buyer tracking one enquiry by a link has no inbox to
 * re-send from, and a new enquiry naming an old one has to be the same person's
 * — which a session proves and a bearer token only suggests.
 */

export type ResendRefusal =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "open"; ref: string }
  | { ok: false; reason: "accepted"; ref: string }
  | { ok: false; reason: "resent"; ref: string; resentAsRef: string };

export interface ResendSource {
  ok: true;
  id: string;
  ref: string;
  requirement: string;
  /** The trade to match in, or null when nothing on the old enquiry says. */
  categoryId: string | null;
  lines: { description: string; qty: number }[];
  emirate: string | null;
  deliverToArea: string | null;
  scale: string | null;
  brief: {
    categoryId: string;
    engagementType: string;
    cadence: string | null;
    startMode: string;
    building: string | null;
    areaId: string | null;
  } | null;
}

export async function resendSource(
  buyerId: string,
  refOrId: string,
  now: Date = new Date(),
): Promise<ResendSource | ResendRefusal> {
  const enquiry = await prisma.enquiry.findFirst({
    where: { OR: [{ ref: refOrId }, { id: refOrId }], buyerId },
    select: {
      id: true,
      ref: true,
      requirement: true,
      closesAt: true,
      contactReleasedToBusinessId: true,
      emirate: true,
      areaId: true,
      deliverToArea: true,
      scale: true,
      resentAs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { ref: true } },
      lines: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { description: true, qty: true, product: { select: { categoryId: true } } },
      },
      recipients: { select: { business: { select: { primaryCategoryId: true } } } },
      serviceBrief: {
        select: { categoryId: true, engagementType: true, cadence: true, startMode: true, building: true },
      },
    },
  });

  if (!enquiry) return { ok: false, reason: "not_found" };
  if (enquiry.contactReleasedToBusinessId) return { ok: false, reason: "accepted", ref: enquiry.ref };
  if (enquiry.closesAt.getTime() > now.getTime()) return { ok: false, reason: "open", ref: enquiry.ref };
  const resentAs = enquiry.resentAs[0];
  if (resentAs) return { ok: false, reason: "resent", ref: enquiry.ref, resentAsRef: resentAs.ref };

  const categoryId =
    enquiry.serviceBrief?.categoryId ??
    enquiryTrade({
      productCategoryIds: enquiry.lines.flatMap((line) => (line.product?.categoryId ? [line.product.categoryId] : [])),
      recipientCategoryIds: enquiry.recipients.map((r) => r.business.primaryCategoryId),
    });

  return {
    ok: true,
    id: enquiry.id,
    ref: enquiry.ref,
    requirement: enquiry.requirement,
    categoryId,
    lines: enquiry.lines.map((line) => ({ description: line.description, qty: line.qty ?? 1 })),
    emirate: enquiry.emirate,
    deliverToArea: enquiry.deliverToArea,
    scale: enquiry.scale,
    brief: enquiry.serviceBrief
      ? {
          categoryId: enquiry.serviceBrief.categoryId,
          engagementType: enquiry.serviceBrief.engagementType,
          cadence: enquiry.serviceBrief.cadence,
          startMode: enquiry.serviceBrief.startMode,
          building: enquiry.serviceBrief.building,
          areaId: enquiry.areaId,
        }
      : null,
  };
}

/**
 * The id a new enquiry may record as `resentFromId`, re-checked at the send.
 *
 * The composer carries a reference, and a form can post any reference. Only an
 * expired, unaccepted enquiry of the same buyer that has not already been
 * re-sent is recorded; anything else is dropped and the enquiry is sent plain —
 * refusing a buyer's send over a stale back-link would lose the enquiry.
 */
export async function resendSourceIdFor(
  buyerId: string | null,
  ref: string | null | undefined,
  now: Date = new Date(),
): Promise<string | null> {
  if (!buyerId || !ref) return null;
  const source = await resendSource(buyerId, ref, now);
  return source.ok ? source.id : null;
}
