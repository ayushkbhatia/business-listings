import "server-only";
import { prisma } from "@/lib/db/client";
import { resolveDefaultTemplateId } from "@/lib/db/queries/catalogue";
import { templateForCategory } from "@/lib/catalogue/template";
import { facetStateOf, type FacetState } from "@/lib/catalogue/overlay";
import { isMultiselect } from "./spec-values";

/**
 * Which fields govern one product, for the editor and for the save that follows.
 *
 * ## Why this module exists
 *
 * There were four answers to that question in the tree and they disagreed:
 *
 *   1. `page.tsx` read `product.category.defaultTemplate?.id` — no parent hop;
 *   2. `saveProduct` built its `known` set from
 *      `specField.findMany({ template: { defaultForCategories: { some: { id: categoryId } } } })`
 *      — also no parent hop;
 *   3. `templateForCategory` (lib/catalogue/template.ts) does hop, via
 *      `defaultTemplateId ?? parent.defaultTemplateId`;
 *   4. `getSellerTemplateForCategory` did not hop and had no callers at all.
 *
 * A template belongs to the trade, not the niche: the seeded one is on "Valves
 * & fittings" and there is none on "Gate valves" or "Ball valves". Every one of
 * al-marwan's products is filed under a subcategory, so (1) resolved nothing
 * and the editor rendered zero inputs, while (2) resolved nothing and made
 * `known` empty — which silently discarded every spec value the form posted.
 * Two bugs that cancelled into looking like one empty screen.
 *
 * So: one resolver, called by the page and by the action, and nothing resolves
 * a template inline any more.
 *
 * ## The no-clone path is not optional
 *
 * `templateForCategory` returns null where the seller has never cloned, which
 * is most of them. Resolving from it alone would turn "renders nothing" into
 * "silently discards what was typed" for the majority — a worse bug wearing the
 * same clothes. The platform template is the fallback, mapped into the same
 * shape so no caller has to know which path it came down.
 *
 * ## What this is not
 *
 * Not the buyer preview's resolver. `lib/products/buyer-preview.ts` composes
 * 1g's own pair — `getSpecTemplate` (status `live`, highest version) and
 * `getSellerOverlay` — and the two genuinely differ: this one follows
 * `Category.defaultTemplateId` and checks neither status nor version. They
 * coincide on today's seed, which is exactly why a rail captioned "as buyers
 * see it" must not be resolved from here.
 */

/** One field, flattened out of whichever path resolved it. */
export interface EditorTemplateField {
  /** The key `Product.specValues` stores the value under. */
  fieldId: string;
  /** What this seller calls it. The platform's own label where there is no clone. */
  label: string;
  /** The platform's word for it, so a renamed field can show its pairing. Null for an own field. */
  platformLabel: string | null;
  /** The platform key. `lib/spec.ts` reads it to pair `DN100` with `4 inch`. */
  key: string;
  type: string;
  unit: string | null;
  options: string[];
  /** Whether the buyer's filter rail carries this field. */
  isFilterable: boolean;
  /** Board 3h's read-only FILTER state. `platform` is the only one that earns the badge. */
  facet: FacetState;
  /** A field the seller invented. Never a facet, and never on the buyer's product page. */
  own: boolean;
  /** Detached from its platform mapping — keeps its value, leaves the facet. */
  detached: boolean;
  /**
   * Required *now*, with board 4e's grace period already applied.
   *
   * Resolved here rather than shipped as a `requiredFrom` date, because the
   * disabled Save is computed in the browser and a `Date` crossing that
   * boundary means the client and the server can answer differently about one
   * grace period. The server's answer is the only one; see
   * `missingFrom` in lib/catalogue/overlay.ts.
   */
  requiredNow: boolean;
  sortOrder: number;
}

export interface EditorTemplate {
  /** Which path resolved it. The banner says different things about each. */
  source: "clone" | "platform";
  templateName: string;
  /** Route to board 3h, where there is a clone to edit. */
  cloneSlug: string | null;
  /** Board 3h's `YOUR REV 7`. Null on the platform path — there is no revision to count. */
  revision: number | null;
  /** Board 3h's `TRACKS PLATFORM v3`. */
  tracksVersion: number | null;
  fields: EditorTemplateField[];
}

function requiredNowOf(required: boolean, requiredFrom: Date | null, now: Date): boolean {
  return required && (requiredFrom === null || requiredFrom.getTime() <= now.getTime());
}

export async function resolveEditorTemplate(
  businessId: string,
  categoryId: string,
  now = new Date(),
): Promise<EditorTemplate | null> {
  const clone = await templateForCategory(businessId, categoryId);

  if (clone) {
    return {
      source: "clone",
      templateName: clone.name,
      cloneSlug: clone.slug,
      revision: clone.revision,
      tracksVersion: clone.tracksVersion,
      fields: clone.fields.map((field) => ({
        fieldId: field.fieldId,
        label: field.label,
        platformLabel: field.platformLabel,
        key: field.key,
        type: field.type,
        unit: field.unit,
        options: field.options,
        isFilterable: field.isFilterable,
        facet: field.facet,
        own: field.own,
        detached: field.detached,
        requiredNow: requiredNowOf(field.required, field.requiredFrom, now),
        sortOrder: field.sortOrder,
      })),
    };
  }

  const templateId = await resolveDefaultTemplateId(categoryId);
  if (!templateId) return null;

  const template = await prisma.specTemplate.findUnique({
    where: { id: templateId },
    select: {
      name: true,
      version: true,
      fields: {
        orderBy: { sortOrder: "asc" },
        // Every column the editor and the preview need. The narrower select
        // this replaced dropped `key`, `type`, `options` and `requiredFrom`,
        // which is four separate wrong answers: no size pairing, no control
        // shape, no options in a select, and a grace period ignored.
        select: {
          id: true,
          key: true,
          label: true,
          type: true,
          unit: true,
          options: true,
          required: true,
          requiredFrom: true,
          isFilterable: true,
          sortOrder: true,
        },
      },
    },
  });
  if (!template) return null;

  return {
    source: "platform",
    templateName: template.name,
    cloneSlug: null,
    revision: null,
    tracksVersion: template.version,
    fields: template.fields.map((field) => ({
      fieldId: field.id,
      label: field.label,
      platformLabel: field.label,
      key: field.key,
      type: field.type,
      unit: field.unit,
      options: field.options,
      isFilterable: field.isFilterable,
      facet: facetStateOf({ own: false, detached: false, isFilterable: field.isFilterable }),
      own: false,
      detached: false,
      requiredNow: requiredNowOf(field.required, field.requiredFrom, now),
      sortOrder: field.sortOrder,
    })),
  };
}

/**
 * The ids a save is allowed to write.
 *
 * Both kinds of field, because `Product.specValues` keys an own field by the
 * own field's id and a platform field by the `SpecField` id, and the merge
 * refuses anything outside this set. Built from the resolved template rather
 * than queried a second time — that second query is what dropped every own
 * field's value on save.
 */
export function knownFieldIds(template: EditorTemplate): Set<string> {
  return new Set(template.fields.map((field) => field.fieldId));
}

/** The ids whose stored value is an array. See `mergeSpecValues`. */
export function arrayFieldIds(template: EditorTemplate): Set<string> {
  return new Set(
    template.fields.filter((field) => isMultiselect(field.type)).map((field) => field.fieldId),
  );
}

