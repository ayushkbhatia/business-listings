/**
 * What a file is referenced by, and therefore what may be done to it.
 *
 * Pure. The query that finds the references is in `./references.ts`; the rules
 * that read them are here, so the wording on the screen and the refusal in the
 * service cannot drift apart.
 *
 * ## Unattached is not unused
 *
 * The board's rail card offered to delete 41 files and free 380 MB. A file with
 * no product attachment can still be referenced by a published guide, an area
 * page, an enquiry thread — or **a quote a buyer already holds**, which is the
 * one that matters, because the buyer has a link to it.
 *
 * So `unreferenced` is computed across every surface, never inferred from the
 * absence of a product attachment, and a quote-held file is **refused**, not
 * warned about. That is the same position as `3h` §5's flag-not-delist, `6f`'s
 * 301-not-404 and `4e`'s no-grace publish: the platform does not offer a
 * control whose only outcome is destroying something somebody else is relying
 * on.
 *
 * ## What a reference can be, and what it cannot be yet
 *
 * `guide` and `area_page` are in the union and nothing produces them. The spec
 * names published guides (`6d`) and area pages (`6a`) as surfaces that can hold
 * a file, and neither model carries an image column today — `Guide` and
 * `AreaPage` reference categories and copy, not media. The members are here so
 * that adding the column later is a change to one query rather than to every
 * rule that reads its result, and `references.ts` says the same thing at the
 * point where the query would go. Nothing counts them as absent evidence.
 */

export type ReferenceKind =
  | "product"
  | "storefront"
  | "team_member"
  | "certificate"
  | "enquiry"
  | "sent_quote"
  | "claim"
  | "catalogue_import"
  | "guide"
  | "area_page";

export interface Reference {
  kind: ReferenceKind;
  /** What the seller would call the thing holding it. Pre-resolved. */
  label: string;
  /** Where to go to detach it, where that is a place. */
  href?: string;
  /**
   * Whether this reference is on a surface a buyer can reach today.
   *
   * Drives the missing-alt count, which the board left unscoped. Alt text on an
   * unattached file costs nothing; alt text missing from an image on a live
   * page is a public accessibility failure and is what image search reads.
   */
  live: boolean;
  /** True where this file is the product's first image — board 1g's gallery. */
  primary?: boolean;
}

/**
 * A reference that stops a file being deleted, rather than merely being warned
 * about.
 *
 * Only one kind, and deliberately: a sent quote is a document already delivered
 * to a buyer, and the link in it is one we handed over. Everything else can be
 * detached by the seller first, which is what the refusal tells them to do.
 */
export function isHolding(reference: Reference): boolean {
  return reference.kind === "sent_quote";
}

export interface FileState {
  /** No reference anywhere. Safe to delete. */
  unreferenced: boolean;
  /** Cited by a sent quote. Delete is refused; detaching is still allowed. */
  quoteHeld: boolean;
  /** Appears on at least one surface a buyer can reach. */
  live: boolean;
  /** Products carrying it, for the blast radius. */
  productCount: number;
  /** Products where it is the first image and 1g would fall back. */
  primaryFor: string[];
}

export function stateOf(references: readonly Reference[]): FileState {
  return {
    unreferenced: references.length === 0,
    quoteHeld: references.some(isHolding),
    live: references.some((reference) => reference.live),
    productCount: references.filter((reference) => reference.kind === "product").length,
    primaryFor: references
      .filter((reference) => reference.kind === "product" && reference.primary)
      .map((reference) => reference.label),
  };
}

/**
 * Whether a missing alt text is a problem worth counting.
 *
 * Scoped twice, and the board scoped it neither way.
 *
 *   - **Only an image.** A PDF is described by its display name; it has no alt
 *     text to be missing, and counting one would pad the number with files that
 *     have no such field. Passing `null` for a document's alt is not the same
 *     as a document needing alt text, which is a distinction the first version
 *     of this got wrong and the running screen showed immediately.
 *   - **Only where a buyer can read it.** A file nobody can see needs no
 *     description; the count exists to name a public accessibility failure, and
 *     padding it with private files makes it a number a seller learns to
 *     ignore.
 */
export function needsAlt(
  input: { describable: boolean; alt: string | null },
  references: readonly Reference[],
): boolean {
  if (!input.describable) return false;
  if (input.alt !== null && input.alt.trim() !== "") return false;
  return references.some((reference) => reference.live);
}

export type DeleteRefusal = { ok: false; reason: "quote_held"; holders: string[] };
export type DeleteAllowed = {
  ok: true;
  /** Products that lose an image. Named before it runs. */
  products: string[];
  /** Products that lose their *primary* image and fall back to the next. */
  primaryFor: string[];
};

/**
 * May this file be deleted, and what does deleting it cost?
 *
 * Both halves in one function, because a screen that asks "can I" separately
 * from "what happens" is a screen where the two answers can disagree.
 */
export function canDelete(references: readonly Reference[]): DeleteRefusal | DeleteAllowed {
  const holders = references.filter(isHolding).map((reference) => reference.label);
  if (holders.length > 0) return { ok: false, reason: "quote_held", holders };

  const state = stateOf(references);
  return {
    ok: true,
    products: references
      .filter((reference) => reference.kind === "product")
      .map((reference) => reference.label),
    primaryFor: state.primaryFor,
  };
}

/** The tile badges, in the order they render. Words, never colour alone. */
export type BadgeKind = "no_alt" | "quote_held" | "unreferenced" | "primary";

export function badgesFor(input: {
  /** False for a document, which carries a display name rather than alt text. */
  describable: boolean;
  alt: string | null;
  references: readonly Reference[];
}): BadgeKind[] {
  const state = stateOf(input.references);
  const badges: BadgeKind[] = [];
  if (needsAlt(input, input.references)) badges.push("no_alt");
  if (state.quoteHeld) badges.push("quote_held");
  if (state.unreferenced) badges.push("unreferenced");
  if (state.primaryFor.length > 0) badges.push("primary");
  return badges;
}

/**
 * The live surface a missing alt text is failing on, for the badge's label.
 *
 * The board's chip said `14 missing alt text` and named nothing. Naming the
 * page is what makes it fixable: the seller has to know which of their surfaces
 * a buyer is reading it on.
 */
export function liveSurfaceOf(references: readonly Reference[]): Reference | null {
  return references.find((reference) => reference.live) ?? null;
}
