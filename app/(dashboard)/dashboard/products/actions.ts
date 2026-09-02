"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { assertCanEditProduct } from "@/lib/auth/guards";
import { applyImport, previewImport, revertImport, type ImportPreview } from "@/lib/import/service";
import { getSpecFieldOptions } from "@/lib/db/queries/catalogue";
import type { ColumnPlan } from "@/lib/import/columns";
import { cloneTemplate, saveTemplateEdits, type FieldEdit } from "@/lib/catalogue/template";
import { reindexBusiness, reindexProduct } from "@/lib/search/reindex";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Catalogue mutations.
 *
 * Everything arrives as a form, and a form is a suggestion. The product ids in
 * a bulk action are re-scoped to the seller's own business here rather than
 * trusted, and the import plan is re-checked against the price fence in
 * `applyImport` — the mapper will not offer a money column any target but
 * blocked, but the field it posts is a string.
 */

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string };

/**
 * Read the file and guess. Writes nothing.
 *
 * A server action rather than client-side parsing, because the guessing needs
 * the category's spec fields and because the price fence lives on the server.
 * A mapper that classified columns in the browser would be a fence a page could
 * be reloaded without.
 */
export async function previewImportFile(formData: FormData): Promise<PreviewResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditProduct(seat.actor);

  const text = String(formData.get("text") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  const specFields = await getSpecFieldOptions(categoryId);

  try {
    return { ok: true, preview: previewImport(text, specFields) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : t("import.needs_name") };
  }
}

export type BulkResult = { ok: true; changed: number } | { ok: false; error: string };

const BULK_ACTIONS = ["publish", "draft", "out_of_stock", "delete"] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];

function isBulkAction(value: string): value is BulkAction {
  return (BULK_ACTIONS as readonly string[]).includes(value);
}

export async function bulkUpdateProducts(formData: FormData): Promise<BulkResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditProduct(seat.actor);

  const action = String(formData.get("action") ?? "");
  if (!isBulkAction(action)) return { ok: false, error: t("catalogue.bulk.unknown") };

  const ids = formData.getAll("id").map(String).filter(Boolean);
  if (ids.length === 0) return { ok: true, changed: 0 };

  // Scoped, not trusted. An id belonging to another business is simply not
  // matched, so the action reports what it actually changed.
  const where = { id: { in: ids }, businessId: seat.businessId };

  let changed = 0;
  if (action === "delete") {
    ({ count: changed } = await prisma.product.deleteMany({ where }));
    // The catalogue this business is findable by just shrank. Status changes
    // below do not need this: a draft is still something the supplier carries,
    // so it stays in their surface either way.
    if (changed > 0) await reindexBusiness(seat.businessId);
  } else {
    const status = action === "publish" ? "live" : action === "draft" ? "draft" : "out_of_stock";
    ({ count: changed } = await prisma.product.updateMany({
      where,
      data: { status, ...(status === "out_of_stock" ? { availability: "out_of_stock" } : {}) },
    }));
  }

  revalidatePath("/dashboard/products");
  return { ok: true, changed };
}

export type RunImportResult =
  | { ok: true; importRunId: string; created: number; skipped: number }
  | { ok: false; error: string };

export async function runImport(formData: FormData): Promise<RunImportResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const text = String(formData.get("text") ?? "");
  const filename = String(formData.get("filename") ?? "catalogue.csv");
  const categoryId = String(formData.get("categoryId") ?? "");
  const saveAs = String(formData.get("saveAs") ?? "").trim();

  let plan: ColumnPlan;
  try {
    plan = JSON.parse(String(formData.get("plan") ?? "")) as ColumnPlan;
    if (!Array.isArray(plan.columns)) throw new Error("no columns");
  } catch {
    return { ok: false, error: t("import.needs_name") };
  }

  try {
    const result = await applyImport(seat.actor, {
      businessId: seat.businessId,
      categoryId,
      filename,
      text,
      plan,
      ...(saveAs ? { saveAs } : {}),
    });
    if (!result.ok) return result;
    revalidatePath("/dashboard/products");
    return {
      ok: true,
      importRunId: result.importRunId,
      created: result.created,
      skipped: result.skipped.length,
    };
  } catch (error) {
    // PriceColumnError lands here. Its message already names the column and
    // says where prices belong, so it is shown as it is.
    return { ok: false, error: error instanceof Error ? error.message : t("import.needs_name") };
  }
}

export type UndoResult = { ok: true; deleted: number } | { ok: false; error: string };

/**
 * The banner on the catalogue screen posts a plain form, and React requires a
 * form action to return nothing. The wizard uses `undoImport` directly, where
 * it can show what happened; here the page simply re-renders without the
 * banner, which is the same information in a different place.
 */
export async function undoImportForm(formData: FormData): Promise<void> {
  await undoImport(formData);
}

export async function undoImport(formData: FormData): Promise<UndoResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await revertImport(seat.actor, String(formData.get("importRunId") ?? ""));
  if (result.ok) revalidatePath("/dashboard/products");
  return result;
}



/* ── Board 3g — one product ──────────────────────────────────────────────── */

export type SaveProductResult = { ok: true } | { ok: false; error: string };

const AVAILABILITY = ["in_stock", "made_to_order", "indent", "out_of_stock"] as const;
type Availability = (typeof AVAILABILITY)[number];
const STATUSES = ["draft", "live", "out_of_stock"] as const;
type Status = (typeof STATUSES)[number];

function readOptionalInt(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const parsed = Number(raw.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Save one product.
 *
 * There is no price field to save, and no branch here that could add one. The
 * spec values are keyed by platform SpecField id — the same key the CSV
 * importer writes and lib/spec.ts reads — so a seller renaming a field in their
 * own template changes nothing about what is stored.
 */
export async function saveProduct(formData: FormData): Promise<SaveProductResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditProduct(seat.actor);

  const id = String(formData.get("id") ?? "");
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { businessId: true, categoryId: true },
  });
  // Someone else's product and one that does not exist give the same answer.
  if (!existing || existing.businessId !== seat.businessId) {
    return { ok: false, error: t("product.not_found") };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (name === "") return { ok: false, error: t("product.name_label") };

  const availability = String(formData.get("availability") ?? "in_stock");
  const status = String(formData.get("status") ?? "draft");

  // The template's own fields, so a posted key that is not one of them is
  // simply not stored rather than becoming a spec value nothing can read.
  const fields = await prisma.specField.findMany({
    where: { template: { defaultForCategories: { some: { id: existing.categoryId } } } },
    select: { id: true },
  });

  const specValues: Record<string, string> = {};
  for (const field of fields) {
    const value = String(formData.get(`spec.${field.id}`) ?? "").trim();
    if (value !== "") specValues[field.id] = value;
  }

  await prisma.product.update({
    where: { id },
    data: {
      name,
      sku: String(formData.get("sku") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      availability: (AVAILABILITY as readonly string[]).includes(availability)
        ? (availability as Availability)
        : "in_stock",
      status: (STATUSES as readonly string[]).includes(status)
        ? (status as Status)
        : "draft",
      stockQty: readOptionalInt(formData.get("stockQty")),
      leadTimeDays: readOptionalInt(formData.get("leadTimeDays")),
      minOrderQty: readOptionalInt(formData.get("minOrderQty")),
      specValues,
    },
  });

  /*
     The match surface, rebuilt from what was just written.

     Without this the edit is invisible to search: `search_text` was only ever
     written by the seed, so a seller who corrected a size here kept whatever
     the row said before, and one who added a spec value was never findable by
     it. The business's own surface is refreshed with it — its catalogue just
     changed — which is why this is one call and not two.
  */
  await reindexProduct(id);

  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${id}`);
  return { ok: true };
}

/* ── Board 3h — the seller's own template ────────────────────────────────── */

export type SaveTemplateActionResult =
  | { ok: true; renamed: number }
  | { ok: false; error: string };

export async function saveTemplate(formData: FormData): Promise<SaveTemplateActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const sellerTemplateId = String(formData.get("sellerTemplateId") ?? "");
  const fieldIds = formData.getAll("fieldId").map(String);

  const edits: FieldEdit[] = fieldIds.map((platformFieldId, index) => ({
    platformFieldId,
    label: String(formData.get(`label.${platformFieldId}`) ?? "").trim(),
    hidden: formData.get(`hidden.${platformFieldId}`) === "on",
    sortOrder: index,
  }));

  const result = await saveTemplateEdits(seat.actor, seat.businessId, sellerTemplateId, edits);
  if (!result.ok) return result;

  revalidatePath("/dashboard/templates");
  revalidatePath("/dashboard/products");
  return { ok: true, renamed: result.renamed.length };
}

export type CloneResult = { ok: true; id: string } | { ok: false; error: string };

export async function setUpTemplate(formData: FormData): Promise<CloneResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  try {
    const view = await cloneTemplate(
      seat.actor,
      seat.businessId,
      String(formData.get("platformTemplateId") ?? ""),
    );
    revalidatePath("/dashboard/templates");
    return { ok: true, id: view.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : t("template.none") };
  }
}
