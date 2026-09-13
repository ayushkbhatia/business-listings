"use server";

import { revalidatePath } from "next/cache";
import {
  acceptOffer,
  cloneFromTemplate,
  createTemplate,
  declineOffer,
  deleteTemplate,
  saveTemplate,
} from "@/lib/services/scope-template-service";
import { TRAVELLING_FIELDS } from "@/lib/services/scope-template";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireSellerSeat } from "../_shell";

/**
 * Board `3h-s`'s writers.
 *
 * Thin, like every action here. What matters is which of them touch a
 * `Service`: **`saveTemplateAction` does not**, and that is the board's rule
 * rather than an oversight. A template edit writes one row and produces offers;
 * `acceptOfferAction` is the only path from a template to a live service, one
 * field at a time, on a press.
 */

export interface Refusal {
  ok: false;
  error: string;
  fix: string;
}

const SAVE_FAILED: Refusal = {
  ok: false,
  error: t("scope_template.error.save"),
  fix: t("scope_template.error.save_fix"),
};

const NAME_REQUIRED: Refusal = {
  ok: false,
  error: t("scope_template.error.name"),
  fix: t("scope_template.error.name_fix"),
};

export type CreateResult = { ok: true; slug: string } | Refusal;

export async function createTemplateAction(formData: FormData): Promise<CreateResult> {
  const seat = await requireSellerSeat();
  const made = await createTemplate(
    seat.actor,
    seat.businessId,
    String(formData.get("familyId") ?? ""),
    String(formData.get("name") ?? ""),
  );

  if (!made.ok) {
    if (made.reason === "name_required") return NAME_REQUIRED;
    if (made.reason === "unknown_family") {
      return {
        ok: false,
        error: t("scope_template.error.family"),
        fix: t("scope_template.error.family_fix"),
      };
    }
    return SAVE_FAILED;
  }

  revalidatePath("/dashboard/scope-templates");
  return { ok: true, slug: made.slug };
}

export type SaveResult = { ok: true } | Refusal;

/**
 * Save the template, and nothing else — B4, AC3.
 *
 * There is no service write on this path. What the seller sees after it is the
 * offer list, recomputed from the row that just changed.
 */
export async function saveTemplateAction(formData: FormData): Promise<SaveResult> {
  const seat = await requireSellerSeat();

  const values: Record<string, string> = {};
  for (const field of TRAVELLING_FIELDS) {
    values[field] = String(formData.get(field) ?? "");
  }

  const saved = await saveTemplate(seat.actor, seat.businessId, String(formData.get("id") ?? ""), {
    name: String(formData.get("name") ?? ""),
    values,
  });
  if (!saved.ok) return saved.reason === "name_required" ? NAME_REQUIRED : SAVE_FAILED;

  revalidatePath("/dashboard/scope-templates");
  revalidatePath(`/dashboard/scope-templates/${saved.slug}`);
  return { ok: true };
}

export type DeleteResult = { ok: true } | Refusal;

export async function deleteTemplateAction(formData: FormData): Promise<DeleteResult> {
  const seat = await requireSellerSeat();
  const gone = await deleteTemplate(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (!gone.ok) return SAVE_FAILED;

  revalidatePath("/dashboard/scope-templates");
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export type CloneResult = { ok: true; id: string; filled: number } | Refusal;

export async function cloneAction(formData: FormData): Promise<CloneResult> {
  const seat = await requireSellerSeat();
  const made = await cloneFromTemplate(
    seat.actor,
    seat.businessId,
    String(formData.get("id") ?? ""),
    String(formData.get("name") ?? ""),
  );

  if (!made.ok) {
    if (made.reason === "at_cap") {
      return {
        ok: false,
        error: t("scope_template.error.at_cap", {
          count: made.cap ?? 0,
          formatted: formatCount(made.cap ?? 0),
          plan: made.planName ?? "",
        }),
        fix: t("scope_template.error.at_cap_fix"),
      };
    }
    return SAVE_FAILED;
  }

  revalidatePath("/dashboard/scope-templates");
  revalidatePath("/dashboard/services");
  revalidatePath("/dashboard/setup/services");
  revalidatePath("/dashboard/setup");
  return { ok: true, id: made.id, filled: made.filled };
}

export type OfferResult = { ok: true } | Refusal;

export async function acceptOfferAction(formData: FormData): Promise<OfferResult> {
  const seat = await requireSellerSeat();
  const done = await acceptOffer(
    seat.actor,
    seat.businessId,
    String(formData.get("serviceId") ?? ""),
    String(formData.get("field") ?? ""),
  );
  if (!done.ok) return SAVE_FAILED;

  revalidatePath("/dashboard/scope-templates");
  revalidatePath("/dashboard/services");
  revalidatePath("/dashboard/setup/services");
  revalidatePath("/b/[slug]/s/[service]", "page");
  return { ok: true };
}

export async function declineOfferAction(formData: FormData): Promise<OfferResult> {
  const seat = await requireSellerSeat();
  const done = await declineOffer(
    seat.actor,
    seat.businessId,
    String(formData.get("serviceId") ?? ""),
    String(formData.get("field") ?? ""),
  );
  if (!done.ok) return SAVE_FAILED;

  revalidatePath("/dashboard/scope-templates");
  return { ok: true };
}
