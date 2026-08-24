"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { inviteSeat, revokeInvite, saveRouting } from "@/lib/team/service";
import type { Role } from "@/lib/auth/roles";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/** Board 7d. Every one of these is owner-only, enforced in lib/team/service.ts. */

export type TeamActionResult = { ok: true } | { ok: false; error: string };

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, siteVisitIncluded: true, sortOrder: true,
} as const;

export async function sendInvite(formData: FormData): Promise<TeamActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: seat.businessId },
    select: { plan: { select: PLAN_SELECT } },
  });
  const plan =
    business.plan ?? (await prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT }));

  const result = await inviteSeat(
    seat.actor,
    seat.businessId,
    {
      email: String(formData.get("email") ?? ""),
      roles: [String(formData.get("role") ?? "seller_sales") as Role],
    },
    plan,
  );

  if (!result.ok) {
    // The service reports the cap as a token so this layer can name the plan
    // and the price without the service knowing about either.
    if (result.error === "at_cap" && plan) {
      const better = await prisma.plan.findFirst({
        where: { monthlyPriceAed: { gt: plan.monthlyPriceAed } },
        orderBy: { monthlyPriceAed: "asc" },
        select: { name: true },
      });
      return {
        ok: false,
        error: t("team.at_cap", {
          plan: plan.name,
          cap: String(plan.teamSeats),
          next: better?.name ?? "Pro",
        }),
      };
    }
    return result;
  }

  revalidatePath("/dashboard/team");
  return { ok: true };
}

export async function cancelInvite(formData: FormData): Promise<TeamActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await revokeInvite(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (result.ok) revalidatePath("/dashboard/team");
  return result;
}

export async function saveLeadRouting(formData: FormData): Promise<TeamActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await saveRouting(seat.actor, seat.businessId, {
    routing: String(formData.get("routing") ?? "everyone"),
    escalationMinutes: Number(formData.get("escalationMinutes") ?? 120),
  });
  if (result.ok) revalidatePath("/dashboard/team");
  return result;
}
