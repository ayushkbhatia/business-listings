import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanEditProduct } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";

/**
 * A seller's copy of a category's spec template.
 *
 * Admin ships the template; the seller clones it and edits the labels. The
 * thing that must survive is the mapping back to the platform field, because
 * that is what lets a buyer compare a "Body material" from one supplier with a
 * "Material of construction" from another.
 *
 * The mapping is structural rather than conventional. `SellerTemplate.fieldMappings`
 * is keyed by the platform `SpecField` id, and `Product.specValues` is keyed by
 * the same id — see lib/spec.ts. A seller renaming a field changes the label
 * they see and cannot change the key, so a rename physically cannot drop the
 * mapping. Criterion 6 asks that renaming warns before saving and keeps the
 * mapping; the warning is a courtesy, and this is the guarantee.
 *
 * What a seller may do: rename a field, hide one they do not stock, reorder.
 * What a seller may not do: invent a field. A field nobody else has is a field
 * nobody can filter on, and a template where every seller has their own columns
 * is a spreadsheet, not a comparison.
 */

/** One field as the seller sees it, over the platform field underneath. */
export interface MappedField {
  /** The platform SpecField id. The mapping, and the key `specValues` uses. */
  platformFieldId: string;
  /** The platform's own label, always available so the seller can see the pairing. */
  platformLabel: string;
  /** What this seller calls it. Defaults to the platform label. */
  label: string;
  key: string;
  type: string;
  unit: string | null;
  options: string[];
  required: boolean;
  /** Drives a site-wide filter. Marked FILTER in the editor. */
  isFilterable: boolean;
  hidden: boolean;
  sortOrder: number;
}

/** What is stored in `SellerTemplate.fieldMappings`. Keyed by platform field id. */
export type FieldMappings = Record<string, { label?: string; hidden?: boolean; sortOrder?: number }>;

export interface SellerTemplateView {
  id: string;
  name: string;
  platformTemplateId: string;
  platformTemplateName: string;
  categoryId: string;
  fields: MappedField[];
}

function readMappings(raw: unknown): FieldMappings {
  return (raw ?? {}) as FieldMappings;
}

/**
 * Clone a platform template for this business, or return the existing clone.
 *
 * Idempotent by (business, platform template). Cloning twice would give one
 * seller two sets of labels for the same fields, and nothing downstream could
 * say which was current.
 */
export async function cloneTemplate(
  actor: Actor,
  businessId: string,
  platformTemplateId: string,
): Promise<SellerTemplateView> {
  assertCanEditProduct(actor);
  if (actor.businessId !== businessId) {
    throw new Error("You can only edit your own templates.");
  }

  const existing = await prisma.sellerTemplate.findFirst({
    where: { businessId, platformTemplateId },
    select: { id: true },
  });
  if (existing) return getSellerTemplateOrThrow(businessId, existing.id);

  const platform = await prisma.specTemplate.findUniqueOrThrow({
    where: { id: platformTemplateId },
    select: { id: true, name: true },
  });

  /*
   * An empty mapping object, not a copy of every label.
   *
   * A clone that copies the labels is a snapshot: when admin renames a platform
   * field, every seller who cloned before the rename keeps the old wording
   * forever and nobody knows the two are the same field. Storing only what the
   * seller actually changed means an untouched field follows the platform, and
   * a renamed one is visibly a deliberate choice.
   */
  const created = await prisma.sellerTemplate.create({
    data: {
      businessId,
      platformTemplateId: platform.id,
      name: platform.name,
      fieldMappings: {},
    },
    select: { id: true },
  });

  return getSellerTemplateOrThrow(businessId, created.id);
}

export async function getSellerTemplate(
  businessId: string,
  sellerTemplateId: string,
): Promise<SellerTemplateView | null> {
  const template = await prisma.sellerTemplate.findUnique({
    where: { id: sellerTemplateId },
    select: {
      id: true,
      businessId: true,
      name: true,
      fieldMappings: true,
      platformTemplate: {
        select: {
          id: true,
          name: true,
          categoryId: true,
          fields: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              key: true,
              label: true,
              type: true,
              unit: true,
              options: true,
              required: true,
              isFilterable: true,
              sortOrder: true,
            },
          },
        },
      },
    },
  });

  // Someone else's template and one that does not exist give the same answer.
  if (!template || template.businessId !== businessId) return null;

  const mappings = readMappings(template.fieldMappings);

  const fields: MappedField[] = template.platformTemplate.fields.map((field) => {
    const override = mappings[field.id] ?? {};
    return {
      platformFieldId: field.id,
      platformLabel: field.label,
      label: override.label ?? field.label,
      key: field.key,
      type: field.type,
      unit: field.unit,
      options: field.options,
      required: field.required,
      isFilterable: field.isFilterable,
      hidden: override.hidden ?? false,
      sortOrder: override.sortOrder ?? field.sortOrder,
    };
  });

  fields.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    id: template.id,
    name: template.name,
    platformTemplateId: template.platformTemplate.id,
    platformTemplateName: template.platformTemplate.name,
    categoryId: template.platformTemplate.categoryId,
    fields,
  };
}

async function getSellerTemplateOrThrow(businessId: string, id: string) {
  const view = await getSellerTemplate(businessId, id);
  if (!view) throw new Error("That template cannot be found.");
  return view;
}

export interface FieldEdit {
  platformFieldId: string;
  label?: string;
  hidden?: boolean;
  sortOrder?: number;
}

export type SaveTemplateResult =
  | { ok: true; renamed: { from: string; to: string }[] }
  | { ok: false; error: string };

/**
 * Save the seller's edits.
 *
 * An edit naming a platform field that is not on the template is refused rather
 * than ignored: it means the form and the template have drifted, and writing
 * the half that matched would leave the seller looking at a template that does
 * not say what they saved.
 *
 * A label equal to the platform's own is stored as no override at all, so the
 * field goes back to following the platform if admin renames it later.
 */
export async function saveTemplateEdits(
  actor: Actor,
  businessId: string,
  sellerTemplateId: string,
  edits: readonly FieldEdit[],
): Promise<SaveTemplateResult> {
  assertCanEditProduct(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own templates." };
  }

  const current = await getSellerTemplate(businessId, sellerTemplateId);
  if (!current) return { ok: false, error: "That template cannot be found." };

  const byId = new Map(current.fields.map((f) => [f.platformFieldId, f]));
  for (const edit of edits) {
    if (!byId.has(edit.platformFieldId)) {
      return { ok: false, error: "That template has changed since this page opened. Reload it." };
    }
  }

  const mappings: FieldMappings = {};
  const renamed: { from: string; to: string }[] = [];

  for (const edit of edits) {
    const field = byId.get(edit.platformFieldId)!;
    const label = (edit.label ?? field.label).trim();

    if (label === "") {
      return { ok: false, error: `Give "${field.platformLabel}" a name, or hide it instead.` };
    }

    const entry: FieldMappings[string] = {};
    // Only what differs from the platform. An untouched field follows a later
    // admin rename instead of being frozen at clone time.
    if (label !== field.platformLabel) entry.label = label;
    if (edit.hidden) entry.hidden = true;
    if (edit.sortOrder !== undefined && edit.sortOrder !== field.sortOrder) {
      entry.sortOrder = edit.sortOrder;
    }

    if (label !== field.platformLabel) {
      renamed.push({ from: field.platformLabel, to: label });
    }
    if (Object.keys(entry).length > 0) mappings[edit.platformFieldId] = entry;
  }

  await prisma.sellerTemplate.update({
    where: { id: sellerTemplateId },
    data: { fieldMappings: mappings as unknown as object },
  });

  return { ok: true, renamed };
}

/**
 * The sentence shown before a rename is saved.
 *
 * Criterion 6 asks that a rename warns first. It says what is kept, because the
 * fear a seller has when renaming a field is that the products already filled
 * in against it will lose their values — and they will not.
 */
export function renameWarning(from: string, to: string, productCount: number): string {
  return (
    `"${from}" will be called "${to}" on your products. ` +
    (productCount > 0
      ? `The ${productCount} product${productCount === 1 ? "" : "s"} already using it keep their values, `
      : "Nothing already entered is lost, ") +
    "and buyers filtering on this field still find you — it stays matched to the platform field " +
    `"${from}".`
  );
}
