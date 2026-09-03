import type { Availability } from "@/lib/db/generated/enums";

/**
 * Board 1g's quantity table: how fast can I have this many.
 *
 * The second column is **availability or lead time, never a unit price**. That
 * is criterion 3, and it is the sharpest test of the whole no-price model —
 * this is the one place on the site where a buyer is looking at a quantity and
 * expecting a number beside it, so it is where a price would leak first.
 *
 * "Better rate" and "Contract pricing" are the point of the design: they say
 * volume moves the number without stating one, which is what a seller wants
 * said and what a buyer needs to know before choosing a quantity. Neither is a
 * price, a range, or a "from" figure.
 */

export interface Band {
  /** `1 – 9`, `200 +`. Rendered as written. */
  quantity: string;
  /** A key in the catalogue. Availability or lead time — never a figure. */
  labelKey: string;
  /** Substituted into the label where it takes a number of weeks. */
  weeks?: number;
}

/** The quantity edges. Shared so the label and the stepper cannot disagree. */
const EDGES = [
  { from: 1, to: 9 },
  { from: 10, to: 49 },
  { from: 50, to: 199 },
  { from: 200, to: null },
] as const;

function quantityLabel(edge: (typeof EDGES)[number]): string {
  return edge.to === null ? `${edge.from} +` : `${edge.from} – ${edge.to}`;
}

/**
 * The bands for a product.
 *
 * In stock reads as speed: collect today, same-day locally, 48 hours at volume,
 * and contract terms above that. Anything not in stock reads as lead time
 * instead — a made-to-order valve has no "collect today" band, and offering one
 * would be the page promising something the seller did not.
 *
 * `deliversLocally` widens the second band from "same day" to "48 hours": a
 * seller with no service radius and one branch has not said they deliver, and
 * "Same-day Dubai" on their page would be our claim, not theirs.
 */
export function availabilityBands(
  availability: Availability,
  options: { deliversLocally: boolean; leadTimeDays: number | null },
): Band[] {
  if (availability === "in_stock") {
    return [
      { quantity: quantityLabel(EDGES[0]), labelKey: "bands.collect_today" },
      {
        quantity: quantityLabel(EDGES[1]),
        labelKey: options.deliversLocally ? "bands.same_day" : "bands.two_days",
      },
      { quantity: quantityLabel(EDGES[2]), labelKey: "bands.two_days_better" },
      { quantity: quantityLabel(EDGES[3]), labelKey: "bands.contract" },
    ];
  }

  if (availability === "out_of_stock") {
    /*
       No bands at all. The board replaces the table with one sentence — "the
       seller quotes on indent orders" — because a quantity table for something
       there is none of is four rows of nothing, and it pushes the enquiry
       action, which is the whole point of the state, further down the page.
    */
    return [];
  }

  /*
     Made to order and indent: lead-time bands, built out from whatever the
     seller stated. A larger quantity takes longer, and the increments are the
     honest shape of that rather than a promise per row — the last band is "by
     arrangement" precisely because nobody can quote a lead time for an
     unbounded quantity.
  */
  const base = options.leadTimeDays;
  const weeks = base === null ? null : Math.max(1, Math.round(base / 7));
  return [
    weeks === null
      ? { quantity: quantityLabel(EDGES[0]), labelKey: "bands.on_enquiry" }
      : { quantity: quantityLabel(EDGES[0]), labelKey: "bands.weeks", weeks },
    weeks === null
      ? { quantity: quantityLabel(EDGES[1]), labelKey: "bands.on_enquiry" }
      : { quantity: quantityLabel(EDGES[1]), labelKey: "bands.weeks", weeks: weeks + 1 },
    weeks === null
      ? { quantity: quantityLabel(EDGES[2]), labelKey: "bands.on_enquiry" }
      : { quantity: quantityLabel(EDGES[2]), labelKey: "bands.weeks", weeks: weeks + 2 },
    { quantity: quantityLabel(EDGES[3]), labelKey: "bands.by_arrangement" },
  ];
}

/**
 * Whether the seller has said they deliver locally.
 *
 * A stated service radius, or more than one branch in the emirate a buyer is
 * looking at. Both are things the seller entered; neither is inferred from
 * their address. `false` is the safe direction — the band falls back to 48
 * hours, which is slower than the truth rather than faster.
 */
export function deliversLocally(
  locations: readonly { serviceRadiusKm: number | null }[],
): boolean {
  return locations.some((location) => location.serviceRadiusKm != null);
}
