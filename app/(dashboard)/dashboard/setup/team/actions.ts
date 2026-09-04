"use server";

import { revalidatePath } from "next/cache";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { inviteSeat, revokeInvite, saveRouting } from "@/lib/team/service";
import { resendInvite } from "@/lib/team/invite";
import { readContact } from "@/lib/team/contact";
import type { Role } from "@/lib/auth/roles";
import { t } from "@/lib/i18n";
import { requireSellerSeat } from "../../_shell";

/**
 * Board 8d's writers.
 *
 * ## Why this screen has a real send, when 8b and 8c do not
 *
 * Board 8b commits per file and 8c commits per row; neither has a submit. This
 * one does, and §4 gives the reason: sending an invitation puts a message on
 * somebody else's phone. That is not autosaveable, and a seller who typed a
 * colleague's number into a draft has not yet decided to contact them.
 *
 * The draft rows live in the browser and cost nothing. This is the only thing
 * that reaches anybody.
 */

export interface DraftRow {
  contact: string;
  role: string;
  branchId: string | null;
}

export type SendResult = {
  /** How many actually went, for the confirmation line. */
  sent: number;
  /** Rows that could not be sent, by index, with the reason to show on the row. */
  failed: { index: number; error: string }[];
};

const SEATABLE: readonly string[] = ["seller_manager", "seller_sales"];

/**
 * Send every valid row, and report what happened to the rest. §4.
 *
 * One invalid row does not block the others: the valid ones go, the invalid one
 * stays on screen with its error, and the seller is told how many went. The
 * alternative — refusing the batch because one number has a typo — makes the
 * seller retype the rows that were already right.
 */
export async function sendInvites(rows: DraftRow[]): Promise<SendResult> {
  const seat = await requireSellerSeat();
  const plan = await effectiveFor(seat.businessId);

  const failed: SendResult["failed"] = [];
  let sent = 0;

  for (const [index, row] of rows.entries()) {
    const contact = readContact(row.contact);
    if (!contact.ok) {
      // An empty row is a row the seller left alone, not a mistake to report.
      if (contact.reason !== "empty") {
        failed.push({ index, error: t("team_setup.ambiguous") });
      }
      continue;
    }

    const role = (SEATABLE.includes(row.role) ? row.role : "seller_sales") as Role;
    const result = await inviteSeat(
      seat.actor,
      seat.businessId,
      { contact: row.contact, roles: [role], branchId: row.branchId },
      plan,
    );

    if (result.ok) {
      sent += 1;
      continue;
    }

    failed.push({ index, error: describe(result.error, result.name, plan?.name ?? "") });
  }

  revalidate();
  return { sent, failed };
}

export async function resendInviteAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const seat = await requireSellerSeat();
  const result = await resendInvite(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  revalidate();
  if (result.ok) return { ok: true };
  return {
    ok: false,
    error:
      result.error === "too_soon" ? t("team_setup.resend_too_soon") : result.error,
  };
}

export async function revokeInviteAction(formData: FormData): Promise<{ ok: boolean }> {
  const seat = await requireSellerSeat();
  await revokeInvite(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  revalidate();
  return { ok: true };
}

/**
 * Routing, saved from here as well as from Team settings.
 *
 * §7: a setup screen should not be the only place a permanent setting lives,
 * and the copy under the control says so.
 */
export async function saveRoutingAction(formData: FormData): Promise<{ ok: boolean }> {
  const seat = await requireSellerSeat();
  await saveRouting(seat.actor, seat.businessId, {
    routing: String(formData.get("routing") ?? "round_robin"),
    escalationMinutes: Number(formData.get("escalationMinutes") ?? 120),
  });
  revalidate();
  return { ok: true };
}

/** Service refusals that are a token rather than a sentence. */
function describe(error: string, name: string | undefined, plan: string): string {
  if (error === "at_cap") return t("team_setup.at_cap", { plan });
  if (error === "already_seated") return t("team_setup.already_seated", { name: name ?? "" });
  return error;
}

function revalidate(): void {
  revalidatePath("/dashboard/setup/team");
  revalidatePath("/dashboard/setup");
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard");
}
