import "server-only";
import { prisma } from "@/lib/db/client";
import type { Step } from "./service";

/**
 * A half-finished step, so "Save & exit" is real. Board 2b, criterion 10.
 *
 * *"Onboarding takes six minutes with the licence to hand and a fortnight
 * without it."* The fortnight is the case this exists for — a supplier who
 * starts on a phone in a warehouse, finds the licence is with their PRO, and
 * comes back on Thursday. Losing what they typed is how that supplier becomes a
 * supplier who never finishes.
 *
 * Three rules, and each is a thing a draft store gets wrong:
 *
 *   - **A draft is never a decision.** It holds what a form holds and grants
 *     nothing. `ClaimSubmission` is still the only row that says somebody
 *     claimed something, and it is still written only on submit.
 *   - **A draft is never trusted on the way back in.** Every value is
 *     revalidated by the step's own service before it becomes a row, exactly as
 *     if it had just been typed. It is a convenience, not an authority.
 *   - **A draft is scoped to one person and one listing.** The unique index is
 *     `(userId, businessId, step)`, so two people mid-claim on one contested
 *     listing keep their own — which is the case board 4c is about.
 */

/** What board 2b's form holds. Every field optional: a draft is half-finished. */
export interface VerifyDraft extends Record<string, unknown> {
  route?: "licence_upload" | "phone_callback";
  documentId?: string;
  filename?: string;
  licenceNumber?: string;
  /** `yyyy-mm-dd`, as the date input holds it. */
  licenceExpiry?: string;
  claimantName?: string;
  claimantRole?: string;
}

export async function saveDraft(
  userId: string,
  businessId: string,
  step: Step,
  data: Record<string, unknown>,
): Promise<void> {
  /*
     Replaced wholesale rather than merged. A merge would let a field the
     claimant cleared come back from an older save, which is the one behaviour a
     draft must not have: somebody who deletes a wrong licence number and leaves
     should not find it waiting for them.
  */
  await prisma.onboardingDraft.upsert({
    where: { userId_businessId_step: { userId, businessId, step } },
    create: { userId, businessId, step, data: data as never },
    update: { data: data as never },
  });
}

export async function readDraft<T extends Record<string, unknown>>(
  userId: string,
  businessId: string,
  step: Step,
): Promise<Partial<T>> {
  const row = await prisma.onboardingDraft.findUnique({
    where: { userId_businessId_step: { userId, businessId, step } },
    select: { data: true },
  });
  const data = row?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Partial<T>) : {};
}

/**
 * Drop the draft once the step has produced its row.
 *
 * Called on submit. A draft that outlived its submission would repopulate a
 * form the supplier has already finished with, which reads as the submission
 * having failed.
 */
export async function clearDraft(
  userId: string,
  businessId: string,
  step: Step,
): Promise<void> {
  await prisma.onboardingDraft.deleteMany({ where: { userId, businessId, step } });
}

/**
 * Drop drafts nobody came back to.
 *
 * Ninety days rather than the fortnight the board names: the fortnight is how
 * long a supplier realistically takes, and a cutoff at the typical case deletes
 * the slow half of it. Part of the daily job.
 */
export const DRAFT_KEEP_DAYS = 90;

export async function pruneDrafts(olderThan: Date): Promise<number> {
  const { count } = await prisma.onboardingDraft.deleteMany({
    where: { updatedAt: { lt: olderThan } },
  });
  return count;
}
