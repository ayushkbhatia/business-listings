"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { issueSubscriptionCredit } from "@/lib/billing/service";
import { formatAED } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 12e — the credit that had no button.
 *
 * A credit, never a refund. The platform is never party to a transaction and
 * holds no buyer money to give back; this is a correction against what we
 * charged for a subscription. `InvoiceLine` has a `subscription_credit` kind
 * and no refund kind, so the schema agrees.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

export async function issueCredit(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const fils = Number(formData.get("fils") ?? "");

  // A non-integer here means the form was posted by something other than the
  // form, which rounds before it sends. The service guards the range.
  if (!Number.isInteger(fils)) return { ok: false, error: t("admin.invoices.credit_invalid") };

  try {
    const result = await issueSubscriptionCredit({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      fils,
      description: String(formData.get("description") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/invoices");
    revalidatePath("/admin/revenue");
    return {
      ok: true,
      message: t("admin.invoices.credit_issued", { amount: formatAED(fils / 100) }),
    };
  } catch (error) {
    return refused(error);
  }
}
