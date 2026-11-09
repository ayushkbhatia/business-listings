"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { endViewAs, startViewAs, VIEW_AS_MINUTES } from "@/lib/support/view-as";
import { t } from "@/lib/i18n";

export type ActionResult =
  | { ok: true; message: string }
  // The fix travels with the refusal: `Alert` with a `bad` tone owes the
  // reader a way out, and the form was passing a review-removal hint.
  | { ok: false; error: string; fix: string };

export async function start(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const slug = String(formData.get("slug") ?? "").trim();

  const business = await prisma.business.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!business) {
    return {
      ok: false,
      error: t("admin.support.not_found"),
      fix: t("admin.support.not_found_fix"),
    };
  }

  try {
    const result = await startViewAs({
      actor: seat.actor,
      businessId: business.id,
      ticketRef: String(formData.get("ticket") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: t(result.message), fix: t(result.fix) };
    revalidatePath("/admin/support");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message: t("admin.support.started", { minutes: String(VIEW_AS_MINUTES) }),
    };
  } catch (error) {
    if (error instanceof PermissionError) {
      return {
        ok: false,
        error: t("admin.queue.not_yours"),
        fix: t("admin.support.error.needs_ticket_fix"),
      };
    }
    if (error instanceof AuditReasonError) {
      return {
        ok: false,
        error: t("admin.queue.needs_reason"),
        fix: t("admin.support.reason_hint"),
      };
    }
    throw error;
  }
}

export async function stop(): Promise<ActionResult> {
  const seat = await requireStaff();
  await endViewAs(seat.actor.id);
  revalidatePath("/admin/support");
  revalidatePath("/dashboard");
  return { ok: true, message: t("admin.support.ended") };
}
