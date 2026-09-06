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
 *
 * ## Board 3g's scope chips hide, they do not unmount
 *
 * The product editor filters its grid with the `hidden` attribute, keeping
 * every input and every `spec.present` marker mounted. That is deliberate and
 * it is this module's contract read from the other side: a filtered-out field
 * still posts, so nothing is cleared, and an edit made under one chip survives
 * a save made under another. Unmounting would be safe against deletion and
 * would silently discard that edit instead — the same class of loss, one step
 * further along. Do not "optimise" it into a filtered map.
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
  /**
   * Field ids whose stored value is an array rather than a string.
   *
   * A `multiselect` field — `certification` on the seeded valve template — is
   * written as an array by the seed and read as one by `lib/spec.ts`, which
   * joins it, and by `isFilled`, which counts its length. Nothing here could
   * represent one: every branch assigned a trimmed string, so the first save of
   * a product carrying `["WRAS", "UL listed"]` replaced it with the empty
   * string the single `<Select>` had posted, and the delete branch took it.
   *
   * That was dormant only because the editor resolved no template and rendered
   * no field at all. Fixing the resolver is what would have woken it, which is
   * why this landed first.
   *
   * The wire format is `|`-joined, not comma-joined: an option may legitimately
   * contain a comma ("Grooved, AWWA C606") and the CSV importer already writes
   * comma-joined strings into the same column, so a comma cannot mean both
   * "inside one option" and "between two".
   */
  arrayFields?: ReadonlySet<string>;
}

/**
 * Split a posted multiselect back into the array the column stores.
 *
 * Exported because the editor has to seed the control from the same
 * understanding it posts with, and two readings of one wire format is how the
 * halves drift apart.
 */
export function splitMulti(posted: string): string[] {
  return posted
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export function mergeSpecValues(input: SpecMerge): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...input.stored };

  for (const fieldId of input.presented) {
    // A posted key the template does not carry is not stored, rather than
    // becoming a spec value nothing can read.
    if (!input.known.has(fieldId)) continue;

    const value = (input.posted[fieldId] ?? "").trim();

    if (input.arrayFields?.has(fieldId)) {
      const parts = splitMulti(value);
      if (parts.length === 0) delete merged[fieldId];
      else merged[fieldId] = parts;
      continue;
    }

    if (value === "") delete merged[fieldId];
    else merged[fieldId] = value;
  }

  return merged;
}

/**
 * The stored value of a multiselect field, as a list the control can show.
 *
 * Two writers reach this column and they do not agree on a format. The seed
 * writes a real array; the CSV importer writes one comma-joined string per
 * cell — `lib/import/service.ts` builds `Record<string, string>` and never an
 * array — and `lib/spec.ts` renders both by joining. So a reader that
 * understood only the array would show an imported product as empty, and the
 * first save would then clear a value the buyer could see on the storefront.
 *
 * Comma is the importer's separator and `|` is the form's, which is why this
 * splits on the former and `splitMulti` on the latter. An option containing a
 * comma survives the round trip because it is never re-split after the control
 * has it — see the option union in `SpecGrid`.
 */
export function selectedMulti(stored: unknown): string[] {
  if (Array.isArray(stored)) {
    return stored.filter((part): part is string => typeof part === "string" && part.trim() !== "");
  }
  if (typeof stored !== "string" || stored.trim() === "") return [];
  return stored
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * Whether a field's type means "several of these", and so an array in storage.
 *
 * Here rather than beside the resolver because the editor's grid is a client
 * component and the resolver is `server-only`; this module is the pure half
 * both sides already share, and the answer decides how a value is written.
 *
 * Normalised rather than compared, because an own field's `type` has not always
 * held a type. Board 3h's editor staged `typeLabel()` — "Multi-select · 18
 * options" — into `OwnField.type`, and `readOwnFields` accepts any string, so
 * some rows carry a sentence where a keyword belongs. Stripping everything but
 * the letters makes "Multi-select" and "multiselect" the same answer; a plain
 * `split(" · ")[0].toLowerCase()` would not — and it would send exactly the
 * field whose value is an array down the string branch that deletes it.
 *
 * The writer is fixed too, in `TemplateBoard`'s `stage()`, but a JSON column
 * cannot be backfilled without a migration, so the read stays defensive.
 */
export function isMultiselect(type: string): boolean {
  // The type word is the first segment; "· 18 options" and "· months" are the
  // label's trimmings. Then the hyphen goes, so "Multi-select" and
  // "multiselect" are one answer.
  const word = type.split("·")[0] ?? "";
  return word.replace(/[^a-z]/gi, "").toLowerCase() === "multiselect";
}
