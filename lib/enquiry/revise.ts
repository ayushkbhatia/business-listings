import "server-only";
import { prisma } from "@/lib/db/client";

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
  | { ok: true; revision: number; superseded: number }
  | { ok: false; error: "not_found" | "empty" | "closed" };

export async function reviseRequirement(input: {
  buyerId: string;
  ref: string;
  requirement: string;
  now?: Date;
}): Promise<ReviseResult> {
  const now = input.now ?? new Date();
  const requirement = input.requirement.trim();
  if (requirement.length < 10) return { ok: false, error: "empty" };

  const enquiry = await prisma.enquiry.findFirst({
    where: { ref: input.ref, buyerId: input.buyerId },
    select: { id: true, revision: true, closesAt: true, contactReleasedToBusinessId: true },
  });
  if (!enquiry) return { ok: false, error: "not_found" };

  /*
     A closed or accepted enquiry is a record, not a live request. Revising one
     would send a new requirement to suppliers who can no longer act on it, and
     for an accepted enquiry it would change the thing that was agreed.
  */
  if (enquiry.contactReleasedToBusinessId || now >= enquiry.closesAt) {
    return { ok: false, error: "closed" };
  }

  const next = enquiry.revision + 1;

  const superseded = await prisma.$transaction(async (tx) => {
    await tx.enquiry.update({
      where: { id: enquiry.id },
      data: { requirement, revision: next, revisedAt: now },
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

  return { ok: true, revision: next, superseded };
}
