"use server";

import { revalidatePath } from "next/cache";
import {
  addFeeBasis,
  assignFamily,
  removeFeeBasis,
  saveRowOrder,
  setFamilyRetired,
} from "@/lib/services/family-library";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireStaff } from "@/lib/auth/staff";

/**
 * Board `4e-s`'s writers.
 *
 * Every one of them goes through `staffMutation` inside the service, which is
 * `CLAUDE.md` non-negotiable 3 and the reason each takes a `reason`: a taxonomy
 * change moves which fee bases a whole trade is offered, and the log is how
 * anybody later works out who decided that and why.
 */

export interface Refusal {
  ok: false;
  error: string;
  fix: string;
}

const SAVE_FAILED: Refusal = {
  ok: false,
  error: t("admin.scope.error.save"),
  fix: t("admin.scope.error.save_fix"),
};

/**
 * The reason is checked here as well as in `staffMutation`.
 *
 * Not belt and braces: `assertReason` throws, and a thrown error on a server
 * action is a page-level failure rather than a message beside the field the
 * admin left blank. This turns it into the second.
 */
function reasonFrom(formData: FormData): string | null {
  const reason = String(formData.get("reason") ?? "").trim();
  return reason === "" ? null : reason;
}

const NO_REASON: Refusal = {
  ok: false,
  error: t("admin.scope.error.reason"),
  fix: t("admin.scope.error.reason_fix"),
};

export type ScopeResult = { ok: true; note?: string } | Refusal;

export async function assignFamilyAction(formData: FormData): Promise<ScopeResult> {
  const seat = await requireStaff();
  const reason = reasonFrom(formData);
  if (reason === null) return NO_REASON;

  const familyId = String(formData.get("familyId") ?? "");
  const done = await assignFamily(
    seat.actor,
    String(formData.get("categoryId") ?? ""),
    familyId === "" ? null : familyId,
    reason,
  );
  if (!done.ok) return SAVE_FAILED;

  revalidateScope();
  return { ok: true, note: t("admin.scope.assigned") };
}

export async function retireFamilyAction(formData: FormData): Promise<ScopeResult> {
  const seat = await requireStaff();
  const reason = reasonFrom(formData);
  if (reason === null) return NO_REASON;

  const done = await setFamilyRetired(
    seat.actor,
    String(formData.get("familyId") ?? ""),
    String(formData.get("retired") ?? "") === "true",
    reason,
  );
  if (!done.ok) return SAVE_FAILED;

  revalidateScope();
  return { ok: true };
}

export async function removeFeeBasisAction(formData: FormData): Promise<ScopeResult> {
  const seat = await requireStaff();
  const reason = reasonFrom(formData);
  if (reason === null) return NO_REASON;

  const done = await removeFeeBasis(
    seat.actor,
    String(formData.get("familyId") ?? ""),
    String(formData.get("key") ?? ""),
    reason,
  );
  if (!done.ok) {
    return done.reason === "last_basis"
      ? { ok: false, error: t("admin.scope.fee_last"), fix: t("admin.scope.fee_add") }
      : SAVE_FAILED;
  }

  revalidateScope();
  /*
     The count comes back and is said again. B9: services holding the removed
     basis keep it and are flagged, and an admin who has just removed one is
     owed the number rather than a bare "saved".
  */
  return {
    ok: true,
    note: t("admin.scope.fee_removed", {
      count: done.flagged,
      formatted: formatCount(done.flagged),
    }),
  };
}

export async function addFeeBasisAction(formData: FormData): Promise<ScopeResult> {
  const seat = await requireStaff();
  const reason = reasonFrom(formData);
  if (reason === null) return NO_REASON;

  const done = await addFeeBasis(
    seat.actor,
    String(formData.get("familyId") ?? ""),
    String(formData.get("key") ?? ""),
    String(formData.get("label") ?? ""),
    reason,
  );
  if (!done.ok) {
    if (done.reason === "duplicate") {
      return {
        ok: false,
        error: t("admin.scope.error.duplicate"),
        fix: t("admin.scope.error.duplicate_fix"),
      };
    }
    if (done.reason === "blank") {
      return {
        ok: false,
        error: t("admin.scope.error.blank"),
        fix: t("admin.scope.error.blank_fix"),
      };
    }
    return SAVE_FAILED;
  }

  revalidateScope();
  return { ok: true };
}

export async function saveRowOrderAction(formData: FormData): Promise<ScopeResult> {
  const seat = await requireStaff();
  const reason = reasonFrom(formData);
  if (reason === null) return NO_REASON;

  const done = await saveRowOrder(
    seat.actor,
    String(formData.get("familyId") ?? ""),
    String(formData.get("order") ?? "").split(",").filter(Boolean),
    reason,
  );
  if (!done.ok) return SAVE_FAILED;

  revalidateScope();
  /*
     B7: the order is what `1g-s` renders, so this changed every published
     service page in the family. The count is stated rather than implied.
  */
  return {
    ok: true,
    note: t("admin.scope.rows_saved", {
      count: done.affected,
      formatted: formatCount(done.affected),
    }),
  };
}

/**
 * The screens this reaches.
 *
 * The public service pages included: a family's row order *is* their table, so
 * leaving them on the old order would be the admin screen and the buyer's page
 * disagreeing about what was just saved.
 */
function revalidateScope(): void {
  revalidatePath("/admin/spec-library");
  revalidatePath("/dashboard/setup/services");
  revalidatePath("/dashboard/scope-templates");
  revalidatePath("/b/[slug]/s/[service]", "page");
}
