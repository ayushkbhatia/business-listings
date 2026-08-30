"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { setVerificationTier } from "@/lib/verification/service";
import { liftSuspension, suspendBusiness } from "@/lib/business/service";
import { t } from "@/lib/i18n";

/**
 * Board 4f — the three account decisions that had no button.
 *
 * All three services were written, audited and tested, and called by nothing
 * outside their own test file. The logic is theirs; this is the wire.
 *
 * Nothing here re-checks a capability. `staffMutation` inside each service
 * asserts it, and `setVerificationTier` additionally runs the subject check
 * that says a field verifier may only tier a business they have visited. A
 * second check here would be a second place to get it wrong — the screen gates
 * what it *offers*, the service decides what it *permits*, and the two are
 * allowed to disagree in exactly one direction.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

function done(): void {
  revalidatePath("/admin/businesses");
  // The overview counts suspended accounts and unverified listings.
  revalidatePath("/admin");
}

export async function setTier(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const raw = String(formData.get("tier") ?? "");
  const tier = Number(raw);

  // Refused here rather than in the service, because a non-numeric tier means
  // the form was posted by something other than the form.
  if (!Number.isInteger(tier)) return { ok: false, error: t("admin.businesses.tier_invalid") };

  try {
    const result = await setVerificationTier({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      tier,
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done();
    return { ok: true, message: t("admin.businesses.tier_set", { tier: String(result.tier) }) };
  } catch (error) {
    return refused(error);
  }
}

export async function suspend(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await suspendBusiness({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done();
    return { ok: true, message: t("admin.businesses.suspended") };
  } catch (error) {
    return refused(error);
  }
}

export async function lift(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await liftSuspension({
      actor: seat.actor,
      businessId: String(formData.get("businessId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.message };
    done();
    return { ok: true, message: t("admin.businesses.lifted") };
  } catch (error) {
    return refused(error);
  }
}
