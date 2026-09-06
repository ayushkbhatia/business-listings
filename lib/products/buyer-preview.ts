import "server-only";
import { getSpecTemplate } from "@/lib/db/queries/business";
import { getSellerOverlay } from "@/lib/db/queries/storefront-catalogue";
import { previewRows, type PreviewRows } from "./preview-rows";

/**
 * What board 1g renders, resolved for anyone who needs to show it.
 *
 * Two callers: the buyer's product page, and board 3g's preview rail. They read
 * the same two queries and compose them the same way, so the rail's caption —
 * "spec table as buyers see it" — is structural rather than a claim somebody
 * has to keep true by hand.
 *
 * ## Why this is not `resolveEditorTemplate`
 *
 * The editor's resolver follows `Category.defaultTemplateId` and checks neither
 * status nor version. This one is `getSpecTemplate`: the highest-versioned
 * `live` template for the category, falling back to the parent's. They coincide
 * on today's seed and would stop coinciding the moment a `defaultTemplateId`
 * pointed at a superseded version, or a subcategory got a live template of its
 * own. A preview resolved from the editor's answer would pass its parity test
 * by coincidence and then quietly show the seller a table no buyer sees.
 *
 * ## What is missing from it, and is not hidden
 *
 * A field the seller invented is not here. `getSellerOverlay` returns labels
 * and order for platform fields only and never reads `SellerTemplate.ownFields`,
 * and `applyOverlay` maps only what it is handed — so an own field is in the
 * editor's grid and absent from the buyer's page. That is board 3h's gap on
 * board 1g's surface; board 3g is only the first screen where the two sets sit
 * side by side. Widening it would put seller-invented labels into 1g's JSON-LD
 * `additionalProperty`, which nobody has ruled on, so the rail states the
 * difference as a count instead of papering over it.
 */
export interface BuyerPreview extends PreviewRows {
  /** Null where the category has no live template at all. */
  templateName: string | null;
  templateVersion: number | null;
}

export async function buyerPreviewFor(
  businessId: string,
  categoryId: string,
  specValues: unknown,
): Promise<BuyerPreview> {
  const [template, overlay] = await Promise.all([
    getSpecTemplate(categoryId),
    /*
       The seller's own labels and order.

       Only the label and the order move. The key is untouched, so `specValues`
       still resolves, comparison still matches across sellers and the facet
       rail is unaffected — all three read the platform field, which is why a
       rename is safe.
    */
    getSellerOverlay(businessId, categoryId),
  ]);

  return {
    ...previewRows(template?.fields ?? [], overlay, specValues),
    templateName: template?.name ?? null,
    templateVersion: template?.version ?? null,
  };
}
