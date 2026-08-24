"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Board 8e — asking for the site visit tier 3 needs.
 *
 * Nothing here moves `verificationTier` or `visitedAt`. Those are staff-written
 * — a visit that has not happened is not a visit — and the absence of any write
 * to them is the whole of criterion 11 for this screen.
 */

export type VisitResult = { ok: true } | { ok: false; error: string };

export async function requestVisit(formData: FormData): Promise<VisitResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const open = await prisma.siteVisitRequest.findFirst({
    where: { businessId: seat.businessId, cancelledAt: null, completedAt: null },
    select: { id: true },
  });
  if (open) return { ok: false, error: t("visit.requested") };

  await prisma.siteVisitRequest.create({
    data: {
      businessId: seat.businessId,
      requestedById: seat.actor.id,
      preferredNote: String(formData.get("note") ?? "").trim() || null,
    },
  });

  revalidatePath("/dashboard/setup");
  revalidatePath("/dashboard/setup/visit");
  return { ok: true };
}

export async function cancelVisit(formData: FormData): Promise<VisitResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const { count } = await prisma.siteVisitRequest.updateMany({
    where: {
      id: String(formData.get("id") ?? ""),
      businessId: seat.businessId,
      completedAt: null,
    },
    data: { cancelledAt: new Date() },
  });
  if (count === 0) return { ok: false, error: t("product.not_found") };

  revalidatePath("/dashboard/setup");
  revalidatePath("/dashboard/setup/visit");
  return { ok: true };
}
