import "server-only";
import { prisma } from "@/lib/db/client";
import { isFilled } from "@/lib/catalogue/overlay";
import { resolveTemplatesFor } from "./catalogue-templates";
import { resolveEditorTemplate } from "./editor-template";

/**
 * What moving a selection of products to another category would cost.
 *
 * ## Why this is one action and not two
 *
 * Board 3f asks for `Change template…` and `Move category…` as separate bulk
 * actions. In this data model they are the same write. A product has no
 * template pointer — `Product` carries `categoryId` and nothing else, and the
 * template is resolved as `Category.defaultTemplateId ?? parent.defaultTemplateId`.
 * Board 3g reached the same conclusion from the other side: "reassign this
 * product's template" is really "refile this product under a different
 * category".
 *
 * Two buttons for one write would be a lie about the model, and the more
 * dangerous kind — a seller who believed `Change template…` left the category
 * alone would find their products refiled, their breadcrumb moved and their
 * facet rail different. So there is one action, and its preview names both
 * consequences: the values that would be dropped, and the facets gained and
 * lost.
 *
 * ## Why a value is dropped at all
 *
 * `Product.specValues` is keyed by platform `SpecField.id`. Those ids belong to
 * one `SpecTemplate`, so a category answering to a different template shares
 * none of them and every value becomes unreadable — present in the column,
 * rendered by nothing. Two subcategories of the same trade share a template and
 * drop nothing, which is the common and safe case, and the preview says so
 * rather than warning about a loss that is not happening.
 *
 * Nothing is discarded without being named. That is criterion 6, and it is the
 * same rule board 3g applied to one product and board 3h applied to a template.
 */

export interface DroppedValue {
  /** The seller's own label for the field, as they see it in the editor. */
  label: string;
  /** How many of the selected products carry a value in it. */
  products: number;
  /** One example, so the seller recognises what they are losing. */
  sample: string;
}

export interface MovePreview {
  /** Products that would move. Excludes any already in the target. */
  products: number;
  /** Already filed there; the move is a no-op for them. */
  alreadyThere: number;
  targetCategoryName: string;
  /** The seller's name for the template the target answers to. Null if none. */
  targetTemplateName: string | null;
  /** True when every selected product already answers to the target's template. */
  sameTemplate: boolean;
  /** Values that would stop being readable, by field, worst first. */
  dropped: DroppedValue[];
  /** Total values dropped across the selection. The headline number. */
  droppedValues: number;
  /** Facet labels the products gain by moving. */
  facetsGained: string[];
  /** Facet labels they lose — comparison rows a buyer will stop seeing. */
  facetsLost: string[];
  /**
   * The target has no template at all.
   *
   * Moving here makes every product unpublishable, because the template *is*
   * the spec table board 1g renders. Worth its own flag: it is not a partial
   * loss, it is the whole page.
   */
  targetUntemplated: boolean;
}

export async function previewMove(
  businessId: string,
  productIds: readonly string[],
  targetCategoryId: string,
): Promise<MovePreview | null> {
  const target = await prisma.category.findUnique({
    where: { id: targetCategoryId },
    select: { id: true, name: true },
  });
  if (!target) return null;

  const products = await prisma.product.findMany({
    // Scoped, never trusted. An id belonging to another business is simply not
    // matched, so the preview describes what would actually happen.
    where: { id: { in: [...productIds] }, businessId },
    select: { id: true, categoryId: true, specValues: true },
  });

  const [{ byCategory }, targetTemplate] = await Promise.all([
    resolveTemplatesFor(businessId, products.map((product) => product.categoryId)),
    resolveEditorTemplate(businessId, targetCategoryId),
  ]);

  const targetIds = new Set((targetTemplate?.fields ?? []).map((field) => field.fieldId));
  const targetFacets = new Set(
    (targetTemplate?.fields ?? [])
      .filter((field) => field.facet === "platform")
      .map((field) => field.label),
  );

  const moving = products.filter((product) => product.categoryId !== targetCategoryId);
  const alreadyThere = products.length - moving.length;

  const byField = new Map<string, DroppedValue>();
  const sourceFacets = new Set<string>();
  let droppedValues = 0;

  for (const product of moving) {
    const template = byCategory.get(product.categoryId);
    const values = (product.specValues ?? {}) as Record<string, unknown>;

    for (const field of template?.fields ?? []) {
      if (field.facet === "platform") sourceFacets.add(field.label);
      if (targetIds.has(field.fieldId)) continue;
      const value = values[field.fieldId];
      if (!isFilled(value)) continue;

      droppedValues += 1;
      const entry = byField.get(field.label);
      const sample = Array.isArray(value) ? value.join(", ") : String(value);
      if (entry) entry.products += 1;
      else byField.set(field.label, { label: field.label, products: 1, sample });
    }
  }

  const dropped = [...byField.values()].sort(
    (a, b) => b.products - a.products || a.label.localeCompare(b.label),
  );

  return {
    products: moving.length,
    alreadyThere,
    targetCategoryName: target.name,
    targetTemplateName: targetTemplate?.templateName ?? null,
    /*
       No values move and no facets change when the target answers to the same
       template — two subcategories of one trade, which is the common case. Said
       explicitly so the preview can stop warning about a loss that is not
       happening; a dialog that cries wolf on the safe case is how a seller
       learns to click through the one that matters.
    */
    sameTemplate: droppedValues === 0 && dropped.length === 0,
    dropped,
    droppedValues,
    facetsGained: [...targetFacets].filter((label) => !sourceFacets.has(label)).sort(),
    facetsLost: [...sourceFacets].filter((label) => !targetFacets.has(label)).sort(),
    targetUntemplated: targetTemplate === null || targetTemplate.fields.length === 0,
  };
}

/**
 * The categories a seller may file a product under.
 *
 * Their own primary and secondary categories and the children of those — the
 * shape `1b` browses and the shape a template belongs to. Not the whole
 * taxonomy: a valve supplier filing a product under "Office furniture" is a
 * mistake the picker should not offer, and board 6c owns the tree itself.
 */
export async function movableCategories(
  businessId: string,
): Promise<{ id: string; name: string }[]> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      sectorId: true,
      primaryCategoryId: true,
      primaryCategory: { select: { parentId: true } },
      categories: { select: { categoryId: true, category: { select: { parentId: true } } } },
    },
  });
  if (!business) return [];

  /*
     Up to the trade, then down to its niches.

     A supplier's primary category is usually a *subcategory* — al-marwan's is
     "Ball valves" — so taking the seller's own categories and their children
     offers exactly one destination, which is a picker with nothing in it. The
     useful set is the sibling niches of the same trade: a valve supplier moving
     a product from ball valves to gate valves keeps the template and loses
     nothing, and that is the move this control exists for.

     `sectorId` is the denormalised top-level ancestor and the cheap way up.
     Falling back to the parent covers a business whose sector has not been
     stamped.
  */
  const roots = new Set<string>();
  if (business.sectorId) roots.add(business.sectorId);
  if (business.primaryCategory?.parentId) roots.add(business.primaryCategory.parentId);
  roots.add(business.primaryCategoryId);
  for (const link of business.categories) {
    roots.add(link.categoryId);
    if (link.category.parentId) roots.add(link.category.parentId);
  }

  const ids = [...roots];
  const categories = await prisma.category.findMany({
    where: { OR: [{ id: { in: ids } }, { parentId: { in: ids } }] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  return categories;
}
