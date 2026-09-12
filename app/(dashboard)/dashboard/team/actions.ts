"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { inviteSeat, removeSeat, resendInvite, revokeInvite, saveRouting } from "@/lib/team/service";
import type { Role } from "@/lib/auth/roles";
import { recordEvent } from "@/lib/telemetry/record";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Board 7d. Every one of these is `team.manage` or `routing.manage`, asserted in
 * lib/team/service.ts rather than here — a server action is a URL, and the check
 * has to hold for a request that never met this screen.
 */

export type TeamActionResult = { ok: true; message?: string } | { ok: false; error: string };

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
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true, serviceLimit: true,
  locationLimit: true, photoLimit: true, publicPhotoLimit: true,
  categoryLimit: true, storageMb: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, analytics: true, csvImport: true, sponsoredEligible: true,
  sortOrder: true,
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
  const role = String(formData.get("role") ?? "seller_sales") as Role;
  /*
     Empty means every branch. Posted as a location id, and `inviteSeat` writes
     it onto the invitation for `acceptInvite` to copy onto the seat — which is
     the only writer `User.branchId` has ever had.
  */
  const branchId = String(formData.get("branchId") ?? "").trim() || null;

  const result = await inviteSeat(
    seat.actor,
    seat.businessId,
    {
      // Board 8d turned this into one field that takes a mobile or an address
      // and sniffs which. This screen still posts an address; the service reads
      // either, so nothing here has to change to keep working.
      contact: email,
      roles: [role],
      branchId,
    },
    plan,
  );

  if (!result.ok) {
    // The service reports the cap as a token so this layer can name the plan
    // and the price without the service knowing about either.
    if (result.error === "at_cap" && plan) {
      await recordEvent({
        name: "cap_reached_invite_blocked",
        businessId: seat.businessId,
        props: { plan: plan.id, cap: plan.teamSeats },
      });
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

  await recordEvent({
    name: "invite_sent",
    businessId: seat.businessId,
    props: { role, scoped: branchId !== null },
  });

  revalidatePath("/dashboard/team");
  return { ok: true, acceptUrl: result.acceptUrl, emailed: result.emailed, email };
}

/**
 * Take a seat back, and move what it was holding first.
 *
 * The destination is posted rather than defaulted. 7d §6.3 makes it a decision —
 * "pick a seat or send them to the unassigned queue" — and a default would make
 * it silently one of the two on a screen whose whole point is that an orphaned
 * lead is the same failure as an unroutable one.
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
     `businessId` against the actor's own, and now the reassignment target's as
     well, so a posted id belonging to somebody else's team is refused rather
     than acted on — which is what makes the screen hiding the control on the
     owner's row a courtesy rather than the fence.
  */
  const reassignToId = String(formData.get("reassignToId") ?? "").trim() || null;
  const result = await removeSeat(seat.actor, String(formData.get("userId") ?? ""), {
    reassignToId,
  });
  if (!result.ok) return result;

  await recordEvent({
    name: "seat_removed",
    businessId: seat.businessId,
    props: { openLeads: result.movedLeads, movedTo: reassignToId === null ? "queue" : "seat" },
  });

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/leads");
  return {
    ok: true,
    message:
      result.movedLeads > 0
        ? t("team.remove_moved", { name: result.name, count: result.movedLeads })
        : t("invite.removed", { name: result.name }),
  };
}

export async function cancelInvite(formData: FormData): Promise<TeamActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await revokeInvite(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (result.ok) revalidatePath("/dashboard/team");
  return result;
}

/**
 * Send an outstanding invitation again.
 *
 * 7d §7: "an expired invite is re-sendable, not silently gone." The once-an-hour
 * limit is `resendInvite`'s, server-side, because each WhatsApp send is a billed
 * conversation and a disabled button is a limit a second tab walks past.
 */
export async function resendTeamInvite(formData: FormData): Promise<TeamActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const id = String(formData.get("id") ?? "");
  const wasExpired = String(formData.get("expired") ?? "") === "true";
  const result = await resendInvite(seat.actor, seat.businessId, id);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "too_soon" ? t("team.resend_too_soon") : result.error,
    };
  }

  await recordEvent({
    name: "invite_resent",
    businessId: seat.businessId,
    props: { expired: wasExpired },
  });

  revalidatePath("/dashboard/team");
  return { ok: true, message: t("team.resent", { contact: String(formData.get("contact") ?? "") }) };
}

export async function saveLeadRouting(formData: FormData): Promise<TeamActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const before = await prisma.business.findUniqueOrThrow({
    where: { id: seat.businessId },
    select: { leadRouting: true, leadEscalationMinutes: true },
  });

  const routing = String(formData.get("routing") ?? "everyone");
  const escalationMinutes = Number(formData.get("escalationMinutes") ?? 120);

  const result = await saveRouting(seat.actor, seat.businessId, { routing, escalationMinutes });
  if (!result.ok) return result;

  /*
     Two events rather than one, because they answer different questions and a
     seller usually moves one of them. A combined `routing_saved` would count a
     visit to the panel, which is `team_viewed`.
  */
  if (before.leadRouting !== routing) {
    await recordEvent({
      name: "routing_mode_changed",
      businessId: seat.businessId,
      props: { from: before.leadRouting, to: routing },
    });
  }
  if (before.leadEscalationMinutes !== escalationMinutes) {
    await recordEvent({
      name: "escalation_interval_changed",
      businessId: seat.businessId,
      props: { fromMinutes: before.leadEscalationMinutes, toMinutes: escalationMinutes },
    });
  }

  revalidatePath("/dashboard/team");
  // The alerts screen carries the same escalation number under its own control.
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
