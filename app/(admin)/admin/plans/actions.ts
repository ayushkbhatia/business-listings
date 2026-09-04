"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { editPlanEntitlements } from "@/lib/billing/entitlements-service";
import { PLAN_CACHE_TAG } from "@/lib/db/queries/pricing";
import { HOME_CACHE_TAG } from "@/lib/db/queries/home";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * One mutation, and it is the destructive-by-choice one.
 *
 * "Apply to existing" is off unless the form says otherwise, and it is read
 * from the checkbox rather than defaulted, because the default is the whole
 * point: a seller who signed up on forty enquiries a month keeps forty until
 * somebody decides otherwise and writes down why.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Empty is unlimited, and the form has to be able to say so. */
function capFrom(value: FormDataEntryValue | null): number | null | undefined {
  if (value === null) return undefined;
  const text = String(value).trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function saveEntitlements(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();

  const changes: Parameters<typeof editPlanEntitlements>[0]["changes"] = {};
  for (const field of ["enquiriesPerMonth", "productLimit", "locationLimit", "photoLimit"] as const) {
    const value = capFrom(formData.get(field));
    if (value !== undefined) changes[field] = value;
  }
  const seats = capFrom(formData.get("teamSeats"));
  // Seats is the one cap that is never unlimited — a plan with unlimited seats
  // is a plan with no seat pricing, which is a commercial decision and not
  // a field.
  if (typeof seats === "number") changes.teamSeats = seats;

  try {
    const result = await editPlanEntitlements({
      actor: seat.actor,
      planId: String(formData.get("planId") ?? ""),
      changes,
      applyToExisting: formData.get("applyToExisting") === "on",
      reason: String(formData.get("reason") ?? ""),
    });

    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/plans");
    revalidatePath("/admin/revenue");
    /*
       The two public surfaces that quote these numbers.

       Both are dynamic routes with cached data, so `revalidatePath` on them
       would clear a route cache neither has. The tags are what actually holds
       criterion 2 of board 1l — the figures on `/` and on `/pricing` are
       identical for the same plan — because until this line existed an edit
       reached `/admin/plans` immediately and the home band up to an hour later.
    */
    revalidateTag(PLAN_CACHE_TAG, { expire: 0 });
    revalidateTag(HOME_CACHE_TAG, { expire: 0 });
    return {
      ok: true,
      message:
        result.existingUpdated === 0
          ? t("admin.plans.saved_none")
          : t("admin.plans.saved", { count: formatCount(result.existingUpdated) }),
    };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.plans.not_yours") };
    if (error instanceof AuditReasonError) {
      return { ok: false, error: t("admin.plans.needs_reason") };
    }
    throw error;
  }
}
