import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";

/**
 * Suspending a business — ops lead only, per §07's cross-surface and staff
 * tables, which agree on this row.
 *
 * The most severe reversible act on the platform. A suspended supplier stops
 * receiving enquiries and stops appearing in results, which for a paying
 * account is the product ending without the subscription ending.
 *
 * Two decisions worth stating, because both are the kind that get "fixed" later
 * by somebody who does not know why they are this way:
 *
 *   - **Nothing is deleted.** The listing, the catalogue, the reviews and the
 *     verification badge all survive a suspension, because a suspension is a
 *     pause with a reason and the reason can turn out to be wrong. The badge in
 *     particular records what we checked, and suspending an account does not
 *     unverify the trade licence we saw.
 *   - **There is no `suspensionReason` column.** The reason lives on the audit
 *     row, which is where the schema puts every other staff reason and which is
 *     the only copy that cannot be edited afterwards.
 */

export type SuspendResult =
  | { ok: true; suspendedAt: Date }
  | { ok: false; error: "not_found" | "already_suspended"; message: string };

export interface SuspendInput {
  actor: Actor;
  businessId: string;
  reason: string;
}

export async function suspendBusiness(input: SuspendInput): Promise<SuspendResult> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, displayName: true, suspendedAt: true },
  });
  if (!business) {
    return { ok: false, error: "not_found", message: "That business is not in the directory." };
  }
  if (business.suspendedAt) {
    return {
      ok: false,
      error: "already_suspended",
      message: `${business.displayName} was suspended on ${business.suspendedAt.toISOString().slice(0, 10)}.`,
    };
  }

  const suspendedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "business.suspend",
        subject: `Business:${business.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const after = await tx.business.update({
          where: { id: business.id },
          data: { suspendedAt },
          select: { id: true, suspendedAt: true },
        });
        return { result: after, before: { suspendedAt: null }, after };
      },
    );
  });

  return { ok: true, suspendedAt };
}

export type LiftResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_suspended"; message: string };

/**
 * Lifting a suspension. Same capability, same audit action, opposite direction —
 * and it needs its own reason, because "we were wrong" and "they fixed it" are
 * different facts about the same business.
 */
export async function liftSuspension(input: SuspendInput): Promise<LiftResult> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, displayName: true, suspendedAt: true },
  });
  if (!business) {
    return { ok: false, error: "not_found", message: "That business is not in the directory." };
  }
  if (!business.suspendedAt) {
    return {
      ok: false,
      error: "not_suspended",
      message: `${business.displayName} is not suspended.`,
    };
  }

  const before = { suspendedAt: business.suspendedAt };

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "business.suspend",
        subject: `Business:${business.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const after = await tx.business.update({
          where: { id: business.id },
          data: { suspendedAt: null },
          select: { id: true, suspendedAt: true },
        });
        return { result: after, before, after };
      },
    );
  });

  return { ok: true };
}
