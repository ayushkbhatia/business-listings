import "server-only";
import { prisma } from "@/lib/db/client";
import { REQUIREMENT_MAX, REQUIREMENT_MIN, SCALE_MAX } from "./service-enquiry";

/**
 * Board 1i criterion 10: editing a requirement creates a revision, not an edit.
 *
 * "Never silently change a requirement under a seller who has already priced
 * it." A supplier who quoted 40 valves and finds the quantity is now 400 has
 * been made to look wrong by somebody else's change, and the quote they are
 * being judged on is no longer a quote for the thing being asked.
 *
 * So three things happen together, in one transaction:
 *
 *   1. The enquiry's revision goes up and `revisedAt` is set. The buyer sees
 *      `REVISED 2 SEP · R2` under the header.
 *   2. Recipients who have **not** quoted simply receive the new text — there
 *      is nothing of theirs to invalidate.
 *   3. Recipients who **have** quoted keep their quote, live and acceptable,
 *      marked `supersededAt`. It is not a status change: the buyer may still
 *      prefer R1's price, and cancelling it on their behalf would throw away
 *      the only reply they have.
 */

export type ReviseResult =
  | { ok: true; enquiryId: string; revision: number; superseded: number }
  | { ok: false; error: "not_found" | "empty" | "too_long" | "scale_too_long" | "closed" | "unchanged" };

export async function reviseRequirement(input: {
  buyerId: string;
  /** The reference or the id — the two the tracking page's links carry. */
  ref: string;
  requirement: string;
  /**
   * Board `1h-s`: the brief's scale, in the buyer's words. `undefined` leaves
   * it as it is; an empty string clears it, which is a real answer (B7).
   */
  scale?: string;
  now?: Date;
}): Promise<ReviseResult> {
  const now = input.now ?? new Date();
  if (input.requirement.trim().length < REQUIREMENT_MIN) return { ok: false, error: "empty" };
  if (input.requirement.length > REQUIREMENT_MAX) return { ok: false, error: "too_long" };
  const scale = input.scale === undefined ? undefined : input.scale.trim().replace(/\s+/g, " ");
  if (scale !== undefined && scale.length > SCALE_MAX) return { ok: false, error: "scale_too_long" };

  const enquiry = await prisma.enquiry.findFirst({
    where: { OR: [{ ref: input.ref }, { id: input.ref }], buyerId: input.buyerId },
    select: {
      id: true,
      revision: true,
      closesAt: true,
      contactReleasedToBusinessId: true,
      requirement: true,
      scale: true,
      serviceBrief: { select: { enquiryId: true } },
    },
  });
  if (!enquiry) return { ok: false, error: "not_found" };

  /*
     A brief's description is kept byte for byte — `1h-s` B2 — on revision as on
     send. A goods requirement keeps the trim it has always had.
  */
  const requirement = enquiry.serviceBrief ? input.requirement : input.requirement.trim();
  const nextScale = scale === undefined || !enquiry.serviceBrief ? enquiry.scale : scale === "" ? null : scale;

  /*
     A closed or accepted enquiry is a record, not a live request. Revising one
     would send a new requirement to suppliers who can no longer act on it, and
     for an accepted enquiry it would change the thing that was agreed.
  */
  if (enquiry.contactReleasedToBusinessId || now >= enquiry.closesAt) {
    return { ok: false, error: "closed" };
  }

  // A revision that changes nothing would still supersede every quote sent.
  if (requirement === enquiry.requirement && nextScale === enquiry.scale) {
    return { ok: false, error: "unchanged" };
  }

  const next = enquiry.revision + 1;

  const superseded = await prisma.$transaction(async (tx) => {
    await tx.enquiry.update({
      where: { id: enquiry.id },
      data: { requirement, scale: nextScale, revision: next, revisedAt: now },
    });

    /*
       Every quote that was sent against the old text. `draft` is excluded
       because it was never sent — there is nobody to notify and nothing the
       buyer has seen.
    */
    const { count } = await tx.quote.updateMany({
      where: {
        enquiryId: enquiry.id,
        status: { notIn: ["draft", "accepted"] },
        supersededAt: null,
      },
      data: { supersededAt: now },
    });
    return count;
  });

  return { ok: true, enquiryId: enquiry.id, revision: next, superseded };
}
