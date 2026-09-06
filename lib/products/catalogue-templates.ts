import "server-only";
import { resolveEditorTemplate, type EditorTemplate } from "./editor-template";
import type { GapField } from "./gaps";

/**
 * The templates governing a page of the catalogue, resolved once each.
 *
 * Board 3f derives two gap counts per row, and both need the row's template —
 * its required flags and its facet set. Resolving per row would be an N+1 over
 * a list that exists to be long, and a seller's whole catalogue answers to a
 * handful of categories, so the work is one resolve per distinct category
 * rather than one per product.
 *
 * `resolveEditorTemplate` is reused rather than reimplemented. It is the single
 * answer to "which template governs this product" — board 3g exists partly
 * because there were four of them and they disagreed — and a faster copy of it
 * here would be a fifth. The catalogue and the editor must agree about one
 * product's gaps down to the number, because the seller reads one figure on
 * this screen and clicks through to the other.
 */
export interface CatalogueTemplates {
  /** By category id, for the rows filed under it. Absent where none resolves. */
  byCategory: Map<string, EditorTemplate>;
  /** The gap-relevant projection, cached alongside so rows share one array. */
  gapFields: Map<string, GapField[]>;
}

export async function resolveTemplatesFor(
  businessId: string,
  categoryIds: readonly string[],
  now = new Date(),
): Promise<CatalogueTemplates> {
  const distinct = [...new Set(categoryIds)];
  const byCategory = new Map<string, EditorTemplate>();
  const gapFields = new Map<string, GapField[]>();

  /*
     Sequential rather than `Promise.all`.

     Every one of these hits the same two tables through the same pooled
     connection, and a seller with a dozen categories firing a dozen concurrent
     resolves against a `connection_limit=1` transaction pooler is how a page
     load turns into a connection error that looks like a code failure. The
     count is small by construction; the latency is not the thing to optimise.
  */
  for (const categoryId of distinct) {
    const template = await resolveEditorTemplate(businessId, categoryId, now);
    if (!template) continue;
    byCategory.set(categoryId, template);
    gapFields.set(
      categoryId,
      template.fields.map((field) => ({
        fieldId: field.fieldId,
        requiredNow: field.requiredNow,
        // The resolved facet state, never `isFilterable`. A detached field
        // keeps its value and leaves the facet, so the two differ — and a
        // filter-gap count built on the wrong one would tell the seller they
        // are missing from a filter that does not exist for them.
        isFacet: field.facet === "platform",
      })),
    );
  }

  return { byCategory, gapFields };
}
