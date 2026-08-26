/**
 * Spec completeness, measured.
 *
 * `Business.specCompleteness` has been `0.4 + rnd() * 0.6` in the seed since
 * handoff 0. That is the third instance of the same lie this project has caught
 * — `responseTimeMedianMs` in handoff 2, `profileStrength` in handoff 3 — and
 * this one is the worst of the three, because it is not only shown, it is
 * **weighted**: `lib/search/ranking.ts` gives it 12 points. Search results have
 * been ordered partly by a random number.
 *
 * This module is pure. The job, the seed and the tests all read it, so they
 * agree by construction rather than by discipline.
 *
 * ## What "complete" means
 *
 * A product is complete when it carries a value for every field its template
 * requires **of it, now**. Two words are doing work there:
 *
 *   - **requires** — `SpecField.required`, and only the filterable ones count
 *     toward findability. A required free-text note a buyer cannot filter on is
 *     worth having and is not what this number is about.
 *   - **now** — `SpecField.requiredFrom` is the grace period. A field added to a
 *     live template with a deadline in the future is not yet required, so the
 *     products filed before it are incomplete-but-valid rather than broken.
 *     That is criterion 4, and it lives here rather than in a screen because a
 *     second code path would get it wrong.
 *
 * A business with no products has `null`, not zero. Zero means "filled nothing
 * in"; null means there is nothing to fill in yet, and the ranking treats an
 * unmeasured signal as half rather than as a failure.
 */

export interface SpecFieldRule {
  /**
   * The `SpecField.id`, which is what `Product.specValues` is keyed by.
   *
   * Not the `key`. Every writer in the product stores values under the field's
   * id — `lib/import/service.ts` and the product editor both do — because a key
   * can be renamed and an id cannot, which is the same reason
   * `SellerTemplate.fieldMappings` maps to ids. Reading by `key` here found
   * nothing and scored every product incomplete, and the first version of this
   * module did exactly that.
   */
  id: string;
  key: string;
  required: boolean;
  isFilterable: boolean;
  /** Null means required from the beginning. */
  requiredFrom: Date | null;
}

export interface ProductSpecs {
  /** The template the product's category points at, resolved by the caller. */
  templateId: string | null;
  /** `Product.specValues`, as stored. */
  values: Record<string, unknown> | null;
}

/** Fields a template requires as of `now`. */
export function requiredNow(fields: readonly SpecFieldRule[], now: Date): SpecFieldRule[] {
  return fields.filter(
    (field) =>
      field.required &&
      field.isFilterable &&
      (field.requiredFrom === null || field.requiredFrom.getTime() <= now.getTime()),
  );
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Is this one product complete against its template's live requirements? */
export function productIsComplete(
  product: ProductSpecs,
  rules: readonly SpecFieldRule[],
  now: Date,
): boolean {
  const required = requiredNow(rules, now);
  // A template that requires nothing is satisfied by anything, including a
  // product with no specs. That is a statement about the template, not the
  // product, and inventing a failure here would punish a seller for our gap.
  if (required.length === 0) return true;

  const values = product.values ?? {};
  return required.every((field) => isFilled(values[field.id]));
}

/**
 * The share of a business's products that are complete, to two decimal places.
 *
 * `null` where the business has no products at all.
 */
export function specCompleteness(
  products: readonly ProductSpecs[],
  rulesByTemplate: ReadonlyMap<string, readonly SpecFieldRule[]>,
  now: Date = new Date(),
): number | null {
  if (products.length === 0) return null;

  let complete = 0;
  for (const product of products) {
    const rules = product.templateId ? (rulesByTemplate.get(product.templateId) ?? []) : [];
    if (productIsComplete(product, rules, now)) complete += 1;
  }

  return Number((complete / products.length).toFixed(2));
}

/**
 * Criterion 4's other half: how many products a new required field would make
 * incomplete, if it started applying now.
 *
 * The screen shows this **before** the version is published, which is the whole
 * point — "this makes 1,842 products incomplete" is a different decision from
 * "this is fine". It is the same arithmetic as above with one extra rule, which
 * is why the two live in one file: a count computed a second way is a count
 * that will eventually disagree with the number it is counting.
 */
export function wouldBeIncomplete(
  products: readonly ProductSpecs[],
  rulesByTemplate: ReadonlyMap<string, readonly SpecFieldRule[]>,
  addition: { templateId: string; field: SpecFieldRule },
  now: Date = new Date(),
): number {
  let affected = 0;

  for (const product of products) {
    if (product.templateId !== addition.templateId) continue;
    // Already incomplete: adding a field does not make it more so, and counting
    // it would overstate what this change costs.
    const existing = rulesByTemplate.get(addition.templateId) ?? [];
    if (!productIsComplete(product, existing, now)) continue;

    const values = product.values ?? {};
    if (!isFilled(values[addition.field.id])) affected += 1;
  }

  return affected;
}
