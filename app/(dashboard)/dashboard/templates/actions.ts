"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import {
  applyDraft,
  cloneTemplate,
  discardDraft,
  getSellerTemplate,
  rollbackTo,
  saveDraft,
} from "@/lib/catalogue/template";
import type { FieldMappings, FieldOverride, OwnField, UnitDisplay } from "@/lib/catalogue/overlay";
import { recordEvent } from "@/lib/telemetry/record";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Board 3h. Every write here stages a draft or applies one — there is no path
 * that edits the live overlay directly, which is §8's rule: no template change
 * applies without passing through the pending-changes review.
 */

export type TemplateActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Stage the whole overlay, not a field at a time.
 *
 * `saveDraft` replaces `draftMappings` wholesale, so a partial post would erase
 * every override missing from it — the same class of bug as the one that made
 * `saveProduct` delete spec values. The form posts the complete overlay and the
 * service refuses an edit naming a field the template does not carry.
 */
export async function saveTemplateDraft(formData: FormData): Promise<TemplateActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const sellerTemplateId = String(formData.get("sellerTemplateId") ?? "");
  const overlay = read(formData.get("overlay"));
  if (!overlay) return { ok: false, error: t("template.not_found") };

  const result = await saveDraft(seat.actor, seat.businessId, sellerTemplateId, overlay);
  if (!result.ok) return result;

  revalidatePath("/dashboard/templates", "layout");
  return { ok: true };
}

export async function applyTemplateDraft(formData: FormData): Promise<TemplateActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const sellerTemplateId = String(formData.get("sellerTemplateId") ?? "");
  const result = await applyDraft(seat.actor, seat.businessId, sellerTemplateId);
  if (!result.ok) return result;

  await recordEvent({
    name: "template_revision_applied",
    businessId: seat.businessId,
    props: {
      revision: result.revision,
      changes: result.changes.length,
      // Which kind of blast radius the seller just accepted. The interesting
      // question is how often a requirement is added, because that is the one
      // change with a consequence the seller cannot see from here.
      flagging: result.changes.filter((change) => change.blast === "flag").length,
    },
  });

  revalidatePath("/dashboard/templates", "layout");
  // Board 3g reads the field order and the labels; board 3f reads the counts.
  revalidatePath("/dashboard/products", "layout");
  return { ok: true, message: t("template.applied", { revision: String(result.revision) }) };
}

export async function discardTemplateDraft(formData: FormData): Promise<TemplateActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await discardDraft(
    seat.actor,
    seat.businessId,
    String(formData.get("sellerTemplateId") ?? ""),
  );
  if (!result.ok) return result;

  revalidatePath("/dashboard/templates", "layout");
  return { ok: true, message: t("template.discarded") };
}

export async function restoreRevision(formData: FormData): Promise<TemplateActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await rollbackTo(
    seat.actor,
    seat.businessId,
    String(formData.get("sellerTemplateId") ?? ""),
    Number(formData.get("revision") ?? 0),
  );
  if (!result.ok) return result;

  await recordEvent({
    name: "template_revision_restored",
    businessId: seat.businessId,
    props: { revision: result.revision },
  });

  revalidatePath("/dashboard/templates", "layout");
  revalidatePath("/dashboard/products", "layout");
  return { ok: true, message: t("template.history_restored", { revision: String(result.revision) }) };
}

export type CloneResult = { ok: true; slug: string } | { ok: false; error: string };

export async function cloneFromLibrary(formData: FormData): Promise<CloneResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  try {
    const view = await cloneTemplate(
      seat.actor,
      seat.businessId,
      String(formData.get("platformTemplateId") ?? ""),
    );
    await recordEvent({
      name: "template_cloned",
      businessId: seat.businessId,
      props: { platformTemplateId: view.platformTemplateId },
    });
    revalidatePath("/dashboard/templates", "layout");
    return { ok: true, slug: view.slug };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : t("template.none") };
  }
}

/** A new field of the seller's own, staged into the draft like every other edit. */
export async function addOwnField(formData: FormData): Promise<TemplateActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const sellerTemplateId = String(formData.get("sellerTemplateId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (label === "") return { ok: false, error: t("template.new_field_label") };

  const view = await getSellerTemplate(seat.actor.businessId ?? "", sellerTemplateId);
  if (!view) return { ok: false, error: t("template.not_found") };

  const own: OwnField[] = [
    ...(view.rawDraftOwnFields ?? view.ownFields),
    {
      /*
         Its own id, generated once and never derived from the label.

         `Product.specValues` keys this field's value by it, exactly as it keys
         a platform field by `SpecField.id` — so renaming an own field is as
         safe as renaming a mapped one, for the same structural reason.
      */
      id: randomUUID(),
      label,
      type: String(formData.get("type") ?? "text"),
      unit: String(formData.get("unit") ?? "").trim() || null,
      options: [],
      required: false,
      sortOrder: view.fields.length,
    },
  ];

  const result = await saveDraft(seat.actor, seat.businessId, sellerTemplateId, {
    mappings: view.rawDraft ?? view.rawApplied,
    ownFields: own,
  });
  if (!result.ok) return result;

  revalidatePath("/dashboard/templates", "layout");
  return { ok: true };
}

/** Parse the posted overlay. A form is a suggestion; this is where it stops. */
function read(raw: FormDataEntryValue | null): { mappings: FieldMappings; ownFields: OwnField[] } | null {
  try {
    const parsed = JSON.parse(String(raw ?? "")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const input = parsed as { mappings?: unknown; ownFields?: unknown };
    const mappings: FieldMappings = {};

    for (const [fieldId, value] of Object.entries((input.mappings ?? {}) as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const override: FieldOverride = {};
      if (typeof entry["label"] === "string") override.label = entry["label"].trim();
      if (typeof entry["sortOrder"] === "number") override.sortOrder = entry["sortOrder"];
      if (typeof entry["required"] === "boolean") override.required = entry["required"];
      if (Array.isArray(entry["options"])) {
        override.options = entry["options"].filter((o): o is string => typeof o === "string");
      }
      if (entry["unitDisplay"] === "primary" || entry["unitDisplay"] === "both") {
        override.unitDisplay = entry["unitDisplay"] as UnitDisplay;
      }
      if (entry["detached"] === true) override.detached = true;
      mappings[fieldId] = override;
    }

    const ownFields: OwnField[] = Array.isArray(input.ownFields)
      ? input.ownFields.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const entry = value as Record<string, unknown>;
          if (typeof entry["id"] !== "string" || typeof entry["label"] !== "string") return [];
          return [
            {
              id: entry["id"],
              label: entry["label"].trim(),
              type: typeof entry["type"] === "string" ? entry["type"] : "text",
              unit: typeof entry["unit"] === "string" ? entry["unit"] : null,
              options: Array.isArray(entry["options"])
                ? entry["options"].filter((o): o is string => typeof o === "string")
                : [],
              required: entry["required"] === true,
              sortOrder: typeof entry["sortOrder"] === "number" ? entry["sortOrder"] : 0,
            },
          ];
        })
      : [];

    return { mappings, ownFields };
  } catch {
    return null;
  }
}
