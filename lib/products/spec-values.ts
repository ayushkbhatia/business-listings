/**
 * Merging a product's spec values with what a form actually showed.
 *
 * ## The bug this exists to make impossible
 *
 * `saveProduct` used to start from `{}` and keep the boxes the form posted.
 * That makes every stored spec value conditional on the template still
 * rendering its field — and board 3g rendered inputs for un-hidden fields only,
 * so a seller who hid a field on /dashboard/templates and then saved any
 * product silently deleted that field's value from it.
 *
 * The cost was not one cell. `Product.specValues` feeds `Business.specCompleteness`,
 * which `lib/search/ranking.ts` weights at twelve of a hundred points, and the
 * spec table every buyer reads. So a control documented as label-only destroyed
 * catalogue data and the seller's own search position, while the rename warning
 * on the same screen promised nothing already entered would be lost.
 *
 * Hiding is gone. This is the structural half: a value can only be cleared by a
 * form that was showing it. Switching sheets, a partial save, a per-field
 * autosave and any future editor that renders a subset are all the same case,
 * and none of them can reach a field they did not display.
 *
 * Pure, because it is a decision rather than a query — and because the failure
 * it prevents is invisible in a screenshot and obvious in a test.
 */

export interface SpecMerge {
  /** `Product.specValues` as stored, before this save. */
  stored: Record<string, unknown>;
  /**
   * The fields the form rendered, from its own `spec.present` markers.
   *
   * Not "the fields on the template": the template is what the server thinks
   * should have been on screen, and the two disagreeing is exactly the case
   * that lost data. What the form says it showed is the only thing that
   * licenses a delete.
   */
  presented: readonly string[];
  /** What came back, per field id. A missing or blank entry means cleared. */
  posted: Record<string, string>;
  /** Field ids the template actually carries. Anything else is ignored. */
  known: ReadonlySet<string>;
}

export function mergeSpecValues(input: SpecMerge): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...input.stored };

  for (const fieldId of input.presented) {
    // A posted key the template does not carry is not stored, rather than
    // becoming a spec value nothing can read.
    if (!input.known.has(fieldId)) continue;

    const value = (input.posted[fieldId] ?? "").trim();
    if (value === "") delete merged[fieldId];
    else merged[fieldId] = value;
  }

  return merged;
}
