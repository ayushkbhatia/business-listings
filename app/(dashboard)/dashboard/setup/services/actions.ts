"use server";

import { revalidatePath } from "next/cache";
import { chooseScopeSheet, seedFromCommonServices } from "@/lib/services/setup";
import { createService, patchServiceField, type EditableField } from "@/lib/services/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireSellerSeat } from "../../_shell";

/**
 * Board `8c-s`'s writers.
 *
 * Thin, like every action here: resolve the seat, hand it to the service,
 * revalidate. The counting rule, the sheet precedence and the seed list live in
 * `lib/services/`, where they are testable without a request.
 *
 * ## Step 1 gates step 2 on the server too
 *
 * B1 says step 2 is inert until a sheet is chosen, and a disabled fieldset is
 * not a gate. `seedFromCommonServices` refuses with `no_sheet`, and adding a
 * row goes through `createService`, whose category is the business's own — so
 * the sheet that service resolves to is the one the seller picked, by
 * construction rather than by a form value.
 */

export type ChooseSheetResult = { ok: true } | { ok: false; error: string; fix: string };

export async function chooseSheetAction(formData: FormData): Promise<ChooseSheetResult> {
  const seat = await requireSellerSeat();
  const chosen = await chooseScopeSheet(
    seat.actor,
    seat.businessId,
    String(formData.get("familyId") ?? ""),
  );

  if (!chosen.ok) {
    return {
      ok: false,
      error: t("setup_services.error.sheet"),
      fix: t("setup_services.error.sheet_fix"),
    };
  }

  /*
     The public pages too. A sheet decides which rows a service renders and in
     what order, so changing it changes every one of this firm's service pages
     — and leaving them on the old order is the preview lying in the other
     direction from B11's.
  */
  revalidatePath("/dashboard/setup/services");
  revalidatePath("/dashboard/services");
  revalidatePath("/dashboard/setup");
  revalidatePath("/b/[slug]/s/[service]", "page");
  return { ok: true };
}

export type SeedListResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string; fix: string };

export async function seedListAction(): Promise<SeedListResult> {
  const seat = await requireSellerSeat();
  const seeded = await seedFromCommonServices(seat.actor, seat.businessId);

  if (!seeded.ok) {
    return {
      ok: false,
      error: t("setup_services.error.seed"),
      fix: t("setup_services.error.seed_fix"),
    };
  }

  revalidatePath("/dashboard/setup/services");
  revalidatePath("/dashboard/services");
  revalidatePath("/dashboard/setup");
  return { ok: true, created: seeded.created, skipped: seeded.skipped };
}

export type AddRowResult = { ok: true; id: string } | { ok: false; error: string; fix: string };

export async function addServiceAction(formData: FormData): Promise<AddRowResult> {
  const seat = await requireSellerSeat();
  const name = String(formData.get("name") ?? "").trim();

  const created = await createService(seat.actor, seat.businessId, name);
  if (!created.ok) {
    if (created.reason === "at_cap") {
      return {
        ok: false,
        error: t("setup_services.error.at_cap", {
          count: created.cap ?? 0,
          formatted: formatCount(created.cap ?? 0),
          plan: created.planName ?? "",
        }),
        fix: t("setup_services.error.at_cap_fix"),
      };
    }
    return {
      ok: false,
      error: t("setup_services.error.add"),
      fix: t("setup_services.error.add_fix"),
    };
  }

  revalidatePath("/dashboard/setup/services");
  revalidatePath("/dashboard/services");
  revalidatePath("/dashboard/setup");
  return { ok: true, id: created.id };
}

export type PatchRowResult = { ok: true } | { ok: false; error: string; fix: string };

/**
 * One field of one row, inline.
 *
 * The same `patchServiceField` the `3g-s` editor calls, which is what keeps the
 * fee-basis rule in one place: a key from another family is refused here for
 * the same reason and with the same message, rather than this screen growing
 * its own validation that agrees until somebody edits one of them.
 *
 * **Four fields, and `indicativeFee` is not among them** — B7, AC7. The amount
 * is collected on `3g-s`, is private, and this screen does not name it.
 */
const INLINE: readonly EditableField[] = ["name", "engagementType", "turnaround", "feeBasis"];

export async function patchRowAction(formData: FormData): Promise<PatchRowResult> {
  const seat = await requireSellerSeat();

  const field = String(formData.get("field") ?? "") as EditableField;
  if (!INLINE.includes(field)) {
    return {
      ok: false,
      error: t("setup_services.error.field"),
      fix: t("setup_services.error.field_fix"),
    };
  }

  const saved = await patchServiceField(
    seat.actor,
    seat.businessId,
    String(formData.get("id") ?? ""),
    field,
    String(formData.get("value") ?? ""),
  );

  if (!saved.ok) {
    if (saved.reason === "name_required") {
      return {
        ok: false,
        error: t("setup_services.error.name"),
        fix: t("setup_services.error.name_fix"),
      };
    }
    if (saved.reason === "foreign_fee_basis") {
      return {
        ok: false,
        error: t("setup_services.error.fee_basis"),
        fix: t("setup_services.error.fee_basis_fix"),
      };
    }
    return {
      ok: false,
      error: t("setup_services.error.save"),
      fix: t("setup_services.error.save_fix"),
    };
  }

  revalidatePath("/dashboard/setup/services");
  revalidatePath("/dashboard/services");
  revalidatePath("/dashboard/setup");
  return { ok: true };
}
