import { FILTERS_EARN_THEIR_PLACE } from "./services-catalogue";

/**
 * Board `1f-s` — the rules of the public coverage page.
 *
 * Pure, so every rule is a unit test and the gallery renders each state from
 * plain objects. `lib/storefront/coverage.ts` fetches; this decides.
 */

export const EMIRATE_ORDER = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;

export type EmirateKey = (typeof EMIRATE_ORDER)[number];

export interface PlaceView {
  emirate: string;
  /** Null for the whole emirate. An area such as Al Ain carries its own id (B7). */
  areaId: string | null;
  label: string;
}

export interface FreeZoneView {
  emirate: string;
  name: string;
}

export interface CoverageRowInput {
  serviceId: string;
  places: readonly PlaceView[];
}

/* ── Where ───────────────────────────────────────────────────────────────── */

/**
 * *All seven emirates* — a row that claims every emirate whole, said in words.
 *
 * Only emirate-wide claims count. Seven emirates' worth of area rows is not the
 * same claim: a firm covering Al Quoz and Mussafah does not cover Dubai and Abu
 * Dhabi, and widening it in the label would be the listing claiming more than
 * the seller did.
 */
export function coversEveryEmirate(places: readonly PlaceView[]): boolean {
  const whole = new Set(places.filter((place) => place.areaId === null).map((place) => place.emirate));
  return EMIRATE_ORDER.every((emirate) => whole.has(emirate));
}

/**
 * The free zones a row is qualified by — B4.
 *
 * **Registrations, not places.** A firm's DMCC registration is a fact about
 * the firm; it is printed beside a service's coverage only where that service
 * reaches the emirate the free zone sits in, because that is where a buyer in
 * the zone will act on it. It is never merged into the places, never a facet
 * value and never a filter — a buyer filtering for Dubai must not be matched on
 * where the firm is registered.
 */
export function rowQualifiers(
  places: readonly PlaceView[],
  registrations: readonly FreeZoneView[],
): string[] {
  const reached = new Set(places.map((place) => place.emirate));
  return registrations.filter((zone) => reached.has(zone.emirate)).map((zone) => zone.name);
}

/**
 * Whether the rows genuinely differ — the lead-in line's condition.
 *
 * *Coverage differs by service here … check the row for the work you need.*
 * On a firm where every service reaches the same places that sentence is
 * false, so it is suppressed and the table stays (the board's *all services
 * same coverage* state).
 */
export function coverageDiffers(rows: readonly CoverageRowInput[]): boolean {
  const keys = new Set(
    rows.map((row) =>
      row.places
        .map((place) => `${place.emirate}:${place.areaId ?? "*"}`)
        .sort()
        .join("|"),
    ),
  );
  return keys.size > 1;
}

/* ── The filter — Q2 ─────────────────────────────────────────────────────── */

/**
 * The emirate filter renders past the same count `1e-s`'s filters do.
 *
 * Q2: pointless at four rows, the page's main affordance on a firm with
 * thirty. One threshold for both pages, so a firm crossing it gains filters on
 * both tabs at once.
 */
export function showsEmirateFilter(rowCount: number): boolean {
  return rowCount > FILTERS_EARN_THEIR_PLACE;
}

/** A row is in when any place it reaches is in the emirate — area rows included. */
export function filterRowsByEmirate<T extends CoverageRowInput>(
  rows: readonly T[],
  emirate: string | null,
): T[] {
  if (!emirate) return [...rows];
  return rows.filter((row) => row.places.some((place) => place.emirate === emirate));
}

/** Only emirates some row reaches. A chip that matches nothing is a dead end. */
export function emirateOptions(rows: readonly CoverageRowInput[]): string[] {
  const reached = new Set(rows.flatMap((row) => row.places.map((place) => place.emirate)));
  return EMIRATE_ORDER.filter((emirate) => reached.has(emirate));
}

/* ── The miss — B6 ───────────────────────────────────────────────────────── */

/**
 * Which emirate the fan-out offer names, and how many firms cover it.
 *
 * *34 cover Ajman for VAT work.* The offer is for the buyer the table failed:
 * so the emirate is one this firm does **not** cover for that service, and of
 * those the one where the most other firms do — the most useful place to send
 * the work. A count of zero is not an offer; the page then makes the offer
 * without a number rather than printing *0 cover Fujairah*.
 */
export function fanoutOffer(
  uncovered: readonly string[],
  counts: ReadonlyMap<string, number>,
): { emirate: string; firms: number } | null {
  let best: { emirate: string; firms: number } | null = null;
  for (const emirate of EMIRATE_ORDER) {
    if (!uncovered.includes(emirate)) continue;
    const firms = counts.get(emirate) ?? 0;
    if (firms > 0 && (best === null || firms > best.firms)) best = { emirate, firms };
  }
  return best;
}

/** The emirates a set of places does not reach at all, in federal order. */
export function uncoveredEmirates(places: readonly PlaceView[]): string[] {
  const reached = new Set(places.map((place) => place.emirate));
  return EMIRATE_ORDER.filter((emirate) => !reached.has(emirate));
}

/**
 * The service the offer is about: the one covering the fewest emirates — the
 * most likely miss — with the firm's own order breaking ties.
 */
export function offerService<T extends CoverageRowInput>(rows: readonly T[]): T | null {
  let best: T | null = null;
  let bestReach = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const reach = new Set(row.places.map((place) => place.emirate)).size;
    if (reach < bestReach && reach < EMIRATE_ORDER.length) {
      best = row;
      bestReach = reach;
    }
  }
  return best;
}
