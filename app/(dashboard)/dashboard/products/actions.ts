"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { assertCanEditProduct } from "@/lib/auth/guards";
import { applyImport, previewImport, revertImport, type ImportPreview } from "@/lib/import/service";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance } from "@/lib/plan/entitlements";
import { refusesPublish, roomLeft } from "@/lib/products/catalogue-query";
import { previewMove, type MovePreview } from "@/lib/products/move-category";
import { createWithUniqueSlug } from "@/lib/products/service";
import { getSpecFieldOptions } from "@/lib/db/queries/catalogue";
import type { ColumnPlan } from "@/lib/import/columns";
import { missingFrom } from "@/lib/catalogue/overlay";
import {
  arrayFieldIds,
  knownFieldIds,
  resolveEditorTemplate,
} from "@/lib/products/editor-template";
import { mergeSpecValues } from "@/lib/products/spec-values";
import { recordEvent } from "@/lib/telemetry/record";
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

export type BulkResult =
  | { ok: true; changed: number }
  /** The plan's product cap refused a publish. `room` is what is left. */
  | { ok: false; error: string; atCap?: true; room?: number }

const BULK_ACTIONS = ["publish", "draft", "out_of_stock", "delete"] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];

function isBulkAction(value: string): value is BulkAction {
  return (BULK_ACTIONS as readonly string[]).includes(value);
}

/**
 * Board 3f's bulk status actions.
 *
 * `publish` is the one with a fence on it. Every other path into `live` already
 * respects the plan's product cap — the CSV importer refuses an over-cap file,
 * the onboarding sheet returns `at_cap` — and a bulk publish that did not would
 * be the widest hole in the ladder, reachable in two clicks from a screen that
 * shows the cap in its own header.
 *
 * `draft` is what board 3f calls `Unpublish…`. The confirmation naming the
 * count and the redirect lives on the screen; this is the write, and the
 * redirect is not something it has to arrange: an unpublished product's URL
 * already 301s to the storefront, because `getProductBySlug` excludes a draft
 * and the page permanently-redirects rather than 404ing when the business is
 * still there. Board 6f's rule, already load-bearing.
 */
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
  } else if (action === "publish") {
    const refusal = await refuseOverCap(seat.businessId, where);
    if (refusal) return refusal;
    ({ count: changed } = await prisma.product.updateMany({
      where,
      data: { status: "live" },
    }));
  } else {
    const status = action === "draft" ? "draft" : "out_of_stock";
    ({ count: changed } = await prisma.product.updateMany({
      where,
      data: { status, ...(status === "out_of_stock" ? { availability: "out_of_stock" } : {}) },
    }));
  }

  revalidatePath("/dashboard/products");
  return { ok: true, changed };
}

/**
 * Whether publishing this selection would take the seller past their cap.
 *
 * Counts only the rows that are not already live: republishing something that
 * is already listed costs no room, and refusing it would make the action look
 * broken to a seller who selected a whole page.
 */
async function refuseOverCap(
  businessId: string,
  where: { id: { in: string[] }; businessId: string },
): Promise<{ ok: false; error: string; atCap: true; room: number } | null> {
  const caps = await effectiveFor(businessId);
  if (!caps) return null;

  const [listed, adding] = await Promise.all([
    prisma.product.count({ where: { businessId, status: "live" } }),
    prisma.product.count({ where: { ...where, status: { not: "live" } } }),
  ]);

  const cap = allowance(caps, "products", listed).cap;
  const room = { cap, listed, adding };
  if (!refusesPublish(room)) return null;

  const left = roomLeft(room) ?? 0;
  return {
    ok: false,
    error: t("catalogue.cap.refused", {
      adding: String(adding),
      room: String(left),
      cap: String(cap ?? 0),
    }),
    atCap: true,
    room: left,
  };
}

export type MovePreviewResult =
  | { ok: true; preview: MovePreview }
  | { ok: false; error: string };

/**
 * What `Move category…` would cost, before it runs.
 *
 * Reads only. Board 3f criterion 6: no value is discarded without being named,
 * and in bulk that means naming them in aggregate — how many products, how many
 * values, and the fields they came from.
 */
export async function previewMoveCategory(formData: FormData): Promise<MovePreviewResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditProduct(seat.actor);

  const ids = formData.getAll("id").map(String).filter(Boolean);
  const targetCategoryId = String(formData.get("categoryId") ?? "");
  if (ids.length === 0 || !targetCategoryId) {
    return { ok: false, error: t("catalogue.move.no_target") };
  }

  const preview = await previewMove(seat.businessId, ids, targetCategoryId);
  if (!preview) return { ok: false, error: t("catalogue.move.no_target") };
  return { ok: true, preview };
}

/**
 * Refile a selection under another category.
 *
 * Which is also what changes their template — a product has no template pointer,
 * and the template is resolved through the category. Board 3f asks for two
 * actions; the data model has one write, and two buttons for it would be a lie
 * about what the seller is doing. See lib/products/move-category.ts.
 *
 * The spec values are left exactly where they are. A value whose field does not
 * exist in the target is unreadable rather than deleted, and moving back
 * restores it — which is the same never-destroy rule the rest of the wave
 * follows, and the reason the preview counts values rather than deleting them.
 */
export async function bulkMoveCategory(formData: FormData): Promise<BulkResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditProduct(seat.actor);

  const ids = formData.getAll("id").map(String).filter(Boolean);
  const categoryId = String(formData.get("categoryId") ?? "");
  if (ids.length === 0 || !categoryId) {
    return { ok: false, error: t("catalogue.move.no_target") };
  }

  const { count } = await prisma.product.updateMany({
    where: { id: { in: ids }, businessId: seat.businessId },
    data: { categoryId },
  });

  /*
     The match surface, and the business's own.

     A product's category name is part of what it is findable by, and moving it
     changes which facets apply — so the index has to be rebuilt or the old
     category's words keep matching it.
  */
  if (count > 0) await reindexBusiness(seat.businessId);

  revalidatePath("/dashboard/products");
  return { ok: true, changed: count };
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
    select: {
      businessId: true,
      categoryId: true,
      specValues: true,
      slug: true,
      // Compared against what was posted, so `stockUpdatedAt` moves only on a
      // real change — see the write below.
      stockQty: true,
      business: { select: { slug: true } },
    },
  });
  // Someone else's product and one that does not exist give the same answer.
  if (!existing || existing.businessId !== seat.businessId) {
    return { ok: false, error: t("product.not_found") };
  }

  const name = String(formData.get("name") ?? "").trim();
  // The label, not a message. This branch used to return "Product name", which
  // rendered in the error banner as a heading with no verb.
  if (name === "") return { ok: false, error: t("product.name_required") };

  const availability = String(formData.get("availability") ?? "in_stock");
  const status = String(formData.get("status") ?? "draft");

  /*
     Merged over what is stored, never rebuilt from the form.

     The decision is in `lib/products/spec-values.ts`, with the failure it
     prevents written out beside it: a value can only be cleared by a form that
     was showing its field.
  */
  /*
     One resolver for the boxes and for the refusal.

     This read `specField.findMany({ template: { defaultForCategories: ... } })`
     — which does not hop to the parent category, while `templateForCategory`
     six lines below it did. Every product in the seeded catalogue is filed
     under a subcategory, so `known` came back empty and every spec value the
     form posted was dropped on the floor, silently, while the requirement check
     read a different template and refused the save naming fields that had no
     box on screen. See lib/products/editor-template.ts.
  */
  const template = await resolveEditorTemplate(seat.businessId, existing.categoryId);

  const presented = formData.getAll("spec.present").map(String);
  const posted: Record<string, string> = {};
  for (const fieldId of presented) posted[fieldId] = String(formData.get(`spec.${fieldId}`) ?? "");

  const specValues = mergeSpecValues({
    stored: (existing.specValues ?? {}) as Record<string, unknown>,
    presented,
    posted,
    // Both kinds of id. The query this replaced returned platform fields only,
    // so a value typed into a field the seller had invented was never stored.
    known: template ? knownFieldIds(template) : new Set<string>(),
    ...(template ? { arrayFields: arrayFieldIds(template) } : {}),
  });

  /*
     Board 3h §5's teeth. A requirement never delists a live product; it blocks
     that product's next save until the field is filled, and holds a new one at
     its first. Nothing enforced this before — `SpecField.required` was read by
     the completeness job and by ranking, and by no writer at all, so a product
     with entirely empty specs could be saved `live`.

     The labels in the refusal are the seller's own, so it names the box they
     are looking at rather than the platform's word for it.
  */
  if (template) {
    const check = missingFrom(template.fields, specValues);
    if (!check.ok) {
      /*
         Recorded from the server, not the browser.

         Whether this save will be refused is a state fact, and a state fact
         taken from a browser is the browser's word for it — lib/telemetry/events.ts
         says so at the top. The count only; the labels are the seller's catalogue.
      */
      await recordEvent({
        name: "product_save_blocked",
        businessId: seat.businessId,
        props: { missing: check.missing.length },
      });
      return { ok: false, error: t("product.missing_required", { fields: check.missing.join(", ") }) };
    }
  }

  const stockQty = readOptionalInt(formData.get("stockQty"));

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
      stockQty,
      /*
         Dated only when the number actually moved.

         `stockUpdatedAt` records when the count was last *stated*, which is what
         lets board 1e show a quantity for thirty days and then stop. Stamping it
         on every save would make a March figure permanently fresh — the exact
         staleness the column exists to catch — and stamping it never leaves a
         corrected count reading as old. So: on a delta, and only on a delta.
      */
      ...(stockQty !== existing.stockQty ? { stockUpdatedAt: new Date() } : {}),
      leadTimeDays: readOptionalInt(formData.get("leadTimeDays")),
      minOrderQty: readOptionalInt(formData.get("minOrderQty")),
      specValues: specValues as Prisma.InputJsonValue,
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
  /*
     The buyer's page too, and by its concrete path.

     Board 1g sets `revalidate = 300`, so without this a corrected spec value is
     invisible to buyers for five minutes after the seller has watched the
     preview rail update. The dynamic pattern `/b/[slug]/p/[product]` would also
     work and would invalidate every product page on the site on every save —
     each one then re-rendered cold by the next crawler, which is the ISR cost
     the workspace rule is about.
  */
  revalidatePath(`/b/${existing.business.slug}/p/${existing.slug}`);
  return { ok: true };
}

/*
   Board 3h's own writes moved to app/(dashboard)/dashboard/templates/actions.ts
   when the screen was rebuilt. `saveTemplate` wrote the live overlay directly;
   every edit now stages a draft and applying it is a separate, confirmed act
   against a list stating each change's blast radius — §8, and the reason the
   board's single `Save & apply to 318` was wrong.

   `setUpTemplate` moved with it: cloning is the templates rail's job now, and
   the index route redirects to the clone it creates.
*/

/* ── Board 3f — one new product ──────────────────────────────────────────── */

export type CreateProductResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * A blank product, filed under the seller's primary category.
 *
 * The category is what decides the template, and the template is what board 3g
 * renders — so a product created without one would open an editor with no
 * fields. The primary category is the honest default and 3g's own category
 * control is where it gets changed.
 *
 * It starts as a **draft**, which is what makes this safe at the plan's cap:
 * the cap is on what is *listed*, not on what is stored, and every rule in this
 * wave says a record is never destroyed or refused for a billing reason. A
 * seller at their limit can still write the product down; publishing it is what
 * needs room, and `bulkUpdateProducts` is where that is refused.
 */
export async function createProduct(formData: FormData): Promise<CreateProductResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditProduct(seat.actor);

  const name = String(formData.get("name") ?? "").trim();
  if (name === "") return { ok: false, error: t("product.name_required") };

  const business = await prisma.business.findUnique({
    where: { id: seat.businessId },
    select: { primaryCategoryId: true },
  });
  if (!business) return { ok: false, error: t("product.not_found") };

  const id = await createWithUniqueSlug(seat.businessId, business.primaryCategoryId, {
    name,
    availability: "in_stock",
    specValues: {},
    live: false,
  });

  revalidatePath("/dashboard/products");
  return { ok: true, id };
}
