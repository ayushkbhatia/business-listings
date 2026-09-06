import { isFilled } from "@/lib/catalogue/overlay";

/**
 * What a missing spec value actually costs, per product.
 *
 * ## Two problems, not one
 *
 * Board 3f's own render carried a single chip reading `62 with missing specs`.
 * The wave had already settled that there are two kinds of gap and that they do
 * entirely different things:
 *
 * | gap | consequence | settled in |
 * |---|---|---|
 * | an empty **required** field | the product's **next save is blocked**; it stays live, in search, ranked as before | board 3h §5, board 3g §1 |
 * | an empty **filterable** field | the product is **absent from that filter** on 1b/1c — not ranked lower, not in the result set | board 3g |
 * | an empty optional field | nothing | — |
 *
 * One is a wall in front of the seller's next edit. The other is reach they
 * will never notice losing. They are found by different work, in a different
 * order, so a count that adds them together is a number the seller cannot act
 * on — which is why the optional gaps are not counted at all: counting them
 * teaches the seller that the whole figure is noise.
 *
 * A field can be both, and then it is both: `nominal_diameter` is required and
 * a facet, so leaving it empty blocks the save *and* drops the product out of
 * the size filter. The two counts overlap on purpose and neither is a subset of
 * the other.
 *
 * ## Pure, and derived at read time
 *
 * No stored column, here or anywhere. A template gaining a field changes every
 * affected product's figures on the next read with no migration and no write —
 * the same rule board 3g's completeness card follows, from the same predicate,
 * so the list and the editor cannot disagree about one product.
 */

/** One field, reduced to what the two counts need. */
export interface GapField {
  fieldId: string;
  /** Required *now*, with board 4e's grace period already applied. */
  requiredNow: boolean;
  /**
   * A category facet on 1b/1c.
   *
   * Read from the resolved facet state, never from `isFilterable`: a detached
   * field keeps its value and leaves the facet, so the two differ, and a count
   * built on the wrong one tells the seller they are missing from a filter that
   * does not exist.
   */
  isFacet: boolean;
}

export interface ProductGaps {
  /** Fields carrying a value. The numerator of the ratio. */
  filled: number;
  /** Every field the template carries. The denominator. */
  total: number;
  /** Empty required fields. This product's next save is blocked. */
  requiredMissing: number;
  /** Empty facet fields. This product is absent from that many buyer filters. */
  filterGaps: number;
}

export function gapsFor(
  fields: readonly GapField[],
  specValues: unknown,
): ProductGaps {
  const values = (specValues ?? {}) as Record<string, unknown>;
  let filled = 0;
  let requiredMissing = 0;
  let filterGaps = 0;

  for (const field of fields) {
    if (isFilled(values[field.fieldId])) {
      filled += 1;
      continue;
    }
    if (field.requiredNow) requiredMissing += 1;
    if (field.isFacet) filterGaps += 1;
  }

  return { filled, total: fields.length, requiredMissing, filterGaps };
}

/**
 * Which of board 3f's two chips a product belongs under.
 *
 * A product can be in both, and the chips are filters rather than a partition —
 * `12 blocked on save` and `50 missing a filter value` describe overlapping
 * sets of the same catalogue, and nothing on the screen adds them together.
 */
export type GapKind = "blocked" | "filter";

export function matchesGap(gaps: ProductGaps, kind: GapKind): boolean {
  return kind === "blocked" ? gaps.requiredMissing > 0 : gaps.filterGaps > 0;
}

/**
 * The order board 3f sorts by when the seller has not chosen another.
 *
 * Blocked first, because it is a wall; then filter gaps by how many, because
 * that is how much reach is missing; then the ones with nothing wrong. Products
 * with no template sort above everything — they cannot be published at all, so
 * they are the worst state a row can be in and the seller cannot discover it
 * from anywhere else.
 *
 * Board 3f's render carried `Sorted by last edited` as static text, which is
 * the one order that guarantees the worst rows are unreachable: a seller with
 * 1,242 products and 125 pages cannot page to their own gaps.
 */
export function gapRank(gaps: ProductGaps, hasTemplate: boolean): number {
  if (!hasTemplate) return 0;
  if (gaps.requiredMissing > 0) return 1;
  if (gaps.filterGaps > 0) return 2;
  return 3;
}
