import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { isPublishable } from "./credentials";
import type { Actor } from "@/lib/auth/roles";

/**
 * Deciding a credential a seller has asked to publish.
 *
 * Board 3e §4 puts `In review · 2 working days` on the seller's screen and
 * names the queue that owns it. The board's own criticism of the version before
 * it was that `In review` had *neither* an SLA nor an owner, "which makes it
 * indistinguishable from a stuck upload" — so a state with no exit would be the
 * same defect with better copy. This is the exit.
 *
 * ## What is being decided, and what is not
 *
 * Not whether the certificate is true. Nothing on this platform checks an ISO
 * number against a registrar or a Civil Defence approval against the
 * authority, and the whole point of the `Verified by us` / `Uploaded by you`
 * split is that the second table makes no claim. A moderator decides one
 * narrower thing: whether the file is the document it says it is and fit to
 * name on a public page.
 *
 * That is why this writes `reviewedAt` and never `verificationTier`. The two
 * are not adjacent decisions with different buttons — they are different kinds
 * of statement, and `setVerificationTier` is one function away in this same
 * directory precisely so the difference is visible when reading either.
 *
 * ## Why rejecting clears `isPublic`
 *
 * A rejected document is not queued forever; it goes back to being a private
 * file the seller holds, with the reason attached. `reviewedAt` is still
 * stamped — somebody did look — so the row leaves the queue rather than
 * reappearing every night. The seller can ask again by making it public again,
 * which is one click and re-enters the queue with the reason still on screen.
 *
 * Nothing is deleted either way. Board 3e open question 5: a document is
 * evidence of a past state, and deleting it makes the tier history unauditable.
 */

export type ReviewResult =
  | { ok: true; approved: boolean }
  | {
      ok: false;
      error: "not_found" | "not_a_credential" | "already_decided";
      message: string;
    };

export interface ReviewInput {
  actor: Actor;
  documentId: string;
  reason: string;
}

/** Everything a seller has asked to publish and nobody has looked at. */
export async function pendingDocumentReviews(limit = 50) {
  return prisma.document.findMany({
    where: { isPublic: true, reviewedAt: null, businessId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      filename: true,
      displayName: true,
      reference: true,
      validUntil: true,
      createdAt: true,
      business: { select: { id: true, displayName: true, slug: true } },
    },
  });
}

export async function pendingDocumentReviewCount(): Promise<number> {
  return prisma.document.count({
    where: { isPublic: true, reviewedAt: null, businessId: { not: null } },
  });
}

async function decide(input: ReviewInput, approved: boolean): Promise<ReviewResult> {
  const document = await prisma.document.findUnique({
    where: { id: input.documentId },
    select: {
      id: true,
      kind: true,
      isPublic: true,
      reviewedAt: true,
      displayName: true,
      businessId: true,
    },
  });
  if (!document || !document.businessId) {
    return { ok: false, error: "not_found", message: "That document is not in the queue." };
  }

  /*
     A trade licence cannot be approved for a storefront, because there is no
     storefront it could reach: `PUBLISHABLE_DOCUMENT_KINDS` fences it out of
     the public query. Refused here as well rather than allowed to write a
     harmless-looking `reviewedAt` that would read, on any later screen, as the
     platform having approved publishing a licence scan.
  */
  if (!isPublishable(document.kind)) {
    return {
      ok: false,
      error: "not_a_credential",
      message:
        "A trade licence or VAT certificate is never published, so there is nothing to decide. " +
        "Set the verification tier instead.",
    };
  }

  if (document.reviewedAt) {
    return {
      ok: false,
      error: "already_decided",
      message: "Somebody has already looked at that document.",
    };
  }

  const before = { isPublic: document.isPublic, reviewedAt: document.reviewedAt };

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "queue.decide",
        subject: `Document:${document.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const after = await tx.document.update({
          where: { id: document.id },
          data: {
            reviewedAt: new Date(),
            reviewReason: input.reason,
            // A rejection returns it to the seller's own files. See the note
            // above: refused, not deleted, and askable again.
            ...(approved ? {} : { isPublic: false }),
          },
          select: { isPublic: true, reviewedAt: true },
        });
        return { result: after, before, after };
      },
    );
  });

  return { ok: true, approved };
}

export function approveDocument(input: ReviewInput): Promise<ReviewResult> {
  return decide(input, true);
}

export function rejectDocument(input: ReviewInput): Promise<ReviewResult> {
  return decide(input, false);
}
