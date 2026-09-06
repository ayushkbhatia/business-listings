/**
 * The shape of a seller's overlay on a platform spec template.
 *
 * Pure, and separate from `./template.ts` because the diff module and the
 * screens both need these types and `./template.ts` is `server-only` — a client
 * component importing it pulls Prisma into the browser bundle, which typecheck
 * and lint both allow and the build catches.
 *
 * ## What a seller owns, and what they do not
 *
 * Board 3h §"The ownership split". Label, order, the options they actually
 * stock, their own extra fields, and their own quality bar — theirs. Which
 * fields buyers can filter on — the platform's, once per category, because a
 * per-seller facet returns a subset of the sellers who hold the data while its
 * count claims otherwise, and hands a seller a switch whose only effect is
 * making them harder to find.
 *
 * ## Why `required` is add-only
 *
 * The platform's requirement is a floor. A seller may add one and may not
 * remove one: the comparison table promises buyers a column, and a template
 * that let each seller opt out of it has holes in exactly the columns it
 * advertised. Board 3h's open question 1, answered as recommended.
 */

/** How a size renders. Board 3h's `DN & inch` / `DN only`. */
export type UnitDisplay = "both" | "primary";

export interface FieldOverride {
  /** Free text. The platform field id underneath is what survives it. */
  label?: string;
  sortOrder?: number;
  /**
   * A requirement this seller adds. The platform's own `required` is a floor
   * this cannot lower — see the note above — so `false` here means "nothing
   * added", never "not required".
   */
  required?: boolean;
  /** The options this seller stocks. A subset of the platform's, never more. */
  options?: string[];
  unitDisplay?: UnitDisplay;
  /**
   * Detached from the platform field.
   *
   * A seller may genuinely mean something different by "size". Detaching drops
   * the field out of comparison and out of any facet, and it is a separate,
   * confirmed action rather than a side effect of renaming — which is the whole
   * reason a rename is safe.
   */
  detached?: boolean;
}

/**
 * What is stored in `SellerTemplate.fieldMappings`. Keyed by platform field id.
 *
 * `hidden` was a member and is not one now. It deleted product data one screen
 * over; see the note at the top of `./template.ts` and migration
 * `20260914090000_drop_field_hidden`. A stored `hidden` is ignored on read.
 */
export type FieldMappings = Record<string, FieldOverride>;

/**
 * A field the seller invented. Warranty, lead time, whatever they compete on.
 *
 * Its `id` is generated once and is what `Product.specValues` keys the value
 * by — the same contract a platform field has, so nothing downstream has to
 * know which kind it is holding.
 *
 * Never a facet and never in comparison: a field nobody else has is a field
 * nobody can filter across, which is what `YOURS ONLY` says on the screen.
 */
export interface OwnField {
  id: string;
  label: string;
  type: string;
  unit: string | null;
  options: string[];
  required: boolean;
  sortOrder: number;
}

export function readMappings(raw: unknown): FieldMappings {
  if (!raw || typeof raw !== "object") return {};
  const out: FieldMappings = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    /*
       A value that is not an object is the old seed's shape —
       `{ sellerKey: platformFieldId }`, from docs/data-model.md, which describes
       the mapping in the opposite direction to the one implemented. It resolved
       to nothing and did nothing; skipping it here says so rather than letting
       a string reach a caller expecting an override.
    */
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const override: FieldOverride = {};
    if (typeof entry["label"] === "string") override.label = entry["label"];
    if (typeof entry["sortOrder"] === "number") override.sortOrder = entry["sortOrder"];
    if (entry["required"] === true) override.required = true;
    if (Array.isArray(entry["options"])) {
      override.options = entry["options"].filter((o): o is string => typeof o === "string");
    }
    if (entry["unitDisplay"] === "primary") override.unitDisplay = "primary";
    if (entry["detached"] === true) override.detached = true;
    out[key] = override;
  }
  return out;
}

export function readOwnFields(raw: unknown): OwnField[] {
  if (!Array.isArray(raw)) return [];
  const out: OwnField[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry["id"] !== "string" || typeof entry["label"] !== "string") continue;
    out.push({
      id: entry["id"],
      label: entry["label"],
      type: typeof entry["type"] === "string" ? entry["type"] : "text",
      unit: typeof entry["unit"] === "string" ? entry["unit"] : null,
      options: Array.isArray(entry["options"])
        ? entry["options"].filter((o): o is string => typeof o === "string")
        : [],
      required: entry["required"] === true,
      sortOrder: typeof entry["sortOrder"] === "number" ? entry["sortOrder"] : 0,
    });
  }
  return out;
}

/** Where a field sits in the buyer's filter rail. Board 3h's `FILTER` column. */
export type FacetState = "platform" | "not_a_facet" | "yours_only";

export function facetStateOf(input: {
  own: boolean;
  detached: boolean;
  isFilterable: boolean;
}): FacetState {
  // A field of the seller's own, or one they have detached, is theirs alone —
  // it cannot be a facet, because a facet is a promise about a whole category.
  if (input.own || input.detached) return "yours_only";
  return input.isFilterable ? "platform" : "not_a_facet";
}
