import type { FacetState } from "@/lib/catalogue/overlay";

/**
 * One row of board 3g's grid, as it crosses to the browser.
 *
 * A plain shape rather than the resolver's own type, because everything here
 * has to survive serialisation into a client component: no `Date`, no method,
 * nothing that has to be recomputed on the other side. `requiredNow` is the
 * clearest case — board 4e's grace period is a comparison against a clock, the
 * server owns the clock, and the browser is handed the answer rather than the
 * ingredients.
 *
 * Its own file so the client grid can import the type without reaching into
 * `page.tsx`, which is a server component.
 */
export interface EditorField {
  fieldId: string;
  label: string;
  /** The platform's own word for it, where the seller has renamed it. */
  platformLabel: string | null;
  unit: string | null;
  type: string;
  options: string[];
  /**
   * Board 3h's read-only FILTER state.
   *
   * The badge reads this and never `isFilterable`: the two differ for a
   * detached field, and a badge that cannot tell "the platform does not filter
   * on this" from "this is yours alone" is how a board's badges come to
   * disagree with the facet set they are supposed to be showing.
   */
  facet: FacetState;
  own: boolean;
  detached: boolean;
  requiredNow: boolean;
  /** The stored value, flattened. A multiselect arrives `|`-joined. */
  value: string;
}
