"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { inviteSeat, removeSeat, revokeInvite, saveRouting } from "@/lib/team/service";
import type { Role } from "@/lib/auth/roles";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/** Board 7d. Every one of these is owner-only, enforced in lib/team/service.ts. */

export type TeamActionResult = { ok: true } | { ok: false; error: string };

/**
 * What the screen needs back from an invitation, which is more than "it worked".
 *
 * The token was minted in the service and dropped here, so an owner whose
 * invitation went to a spam folder had nothing to fall back on — not even a
 * resend, because re-inviting mints a new token and the old one stops working.
 * The link and whether the email actually left are two different facts the
 * owner acts on differently, so both travel.
 */
export type InviteActionResult =
  | { ok: true; acceptUrl: string; emailed: boolean; email: string }
  | { ok: false; error: string };

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, siteVisitIncluded: true, sortOrder: true,
} as const;

export async function sendInvite(formData: FormData): Promise<InviteActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: seat.businessId },
    select: { plan: { select: PLAN_SELECT } },
  });
  const plan =
    business.plan ?? (await prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT }));

  /*
     Normalised here as well as in the service, so the confirmation names the
     address the email actually went to rather than the capitals somebody typed
     into the field.
  */
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  const result = await inviteSeat(
    seat.actor,
    seat.businessId,
    {
      // Board 8d turned this into one field that takes a mobile or an address
      // and sniffs which. This screen still posts an address; the service reads
      // either, so nothing here has to change to keep working.
      contact: email,
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
  return { ok: true, acceptUrl: result.acceptUrl, emailed: result.emailed, email };
}

/**
 * Take a seat back.
 *
 * docs/permissions.md §07 has always said the owner may "invite or remove team
 * members" and only the first half existed, so a colleague seated by mistake —
 * or one who left — kept access to every enquiry, quote and buyer contact on
 * the listing for good.
 *
 * No audit row, for the reason lib/team/invite.ts gives at length: `AuditEvent`
 * records staff decisions, and a supplier moving somebody off their own team is
 * not one. `inviteSeat` writes none either.
 */
export async function removeTeamMember(formData: FormData): Promise<TeamActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  /*
     The business is never read off the form. `removeSeat` compares the target's
     `businessId` against the actor's own, so a posted id belonging to somebody
     else's team is refused rather than acted on — which is what makes the
     screen hiding the control on the owner's row a courtesy rather than the
     fence.
  */
  const result = await removeSeat(seat.actor, String(formData.get("userId") ?? ""));
  if (!result.ok) return result;

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
