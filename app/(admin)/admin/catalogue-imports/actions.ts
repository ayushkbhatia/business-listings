"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import {
  completeCatalogueImport,
  rejectCatalogueImport,
  startCatalogueImport,
  type StaffMoveResult,
} from "@/lib/catalogue-import/service";
import { t } from "@/lib/i18n";

/**
 * Board 12i — the three moves on a catalogue load.
 *
 * Thin by design. The capability check, the audit row and the written reason
 * all live in `lib/catalogue-import/service.ts`, behind `staffMutation`, so a
 * second screen doing the same thing cannot skip any of them —
 * `scripts/check-audit-coverage.mts` enforces that a console screen does not
 * write to Prisma directly, and it has caught exactly this before.
 *
 * The reason is read from the form and passed through untouched. `assertReason`
 * is what refuses a keystroke, and it refuses it in one place.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

/** The service's refusals, in the console's voice. */
function settled(result: StaffMoveResult): ActionResult {
  if (result.ok) {
    revalidatePath("/admin/catalogue-imports");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.reports.resolved") };
  }
  switch (result.error) {
    case "not_found":
      return { ok: false, error: t("admin.visit.not_found") };
    case "out_of_range":
      return {
        ok: false,
        error: t("error.required", { field: t("admin.plans.col.products") }),
      };
    default:
      // Somebody else moved this row while the queue was open. Reloading is
      // the whole of the fix, and nothing has been lost.
      return { ok: false, error: t("admin.queue.error.body") };
  }
}

/**
 * A typed count, or `NaN`.
 *
 * `Number("")` is zero, so an untouched field would otherwise file a completed
 * load claiming nothing went on — and the seller reads that number back in
 * `concierge.loaded`. An empty field is not a count.
 */
function count(value: FormDataEntryValue | null): number {
  const raw = String(value ?? "").trim();
  return raw === "" ? Number.NaN : Number(raw);
}

export async function start(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    return settled(
      await startCatalogueImport(
        seat.actor,
        String(formData.get("id") ?? ""),
        String(formData.get("reason") ?? ""),
      ),
    );
  } catch (error) {
    return refused(error);
  }
}

export async function complete(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    return settled(
      await completeCatalogueImport(seat.actor, String(formData.get("id") ?? ""), {
        productsLoaded: count(formData.get("productsLoaded")),
        reason: String(formData.get("reason") ?? ""),
      }),
    );
  } catch (error) {
    return refused(error);
  }
}

export async function reject(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    return settled(
      await rejectCatalogueImport(
        seat.actor,
        String(formData.get("id") ?? ""),
        String(formData.get("reason") ?? ""),
      ),
    );
  } catch (error) {
    return refused(error);
  }
}
