import type { Emirate } from "@/lib/db/generated/enums";

/**
 * Delivery and service coverage — what a supplier promises, and where.
 *
 * Board 3c's fourth section. The chips are not decoration: they drive `1h`'s
 * RFQ routing and sit beside the `1b`/`1c` facets, which is why the areas come
 * from the taxonomy rather than a text field. A typed area matches nothing, and
 * the seller never finds out why the enquiries stopped.
 *
 * Pure, and deliberately so — the picker runs in the browser and validates the
 * same scope rules the server enforces.
 */

/* ── The promise ─────────────────────────────────────────────────────────── */

/**
 * The promises the screen offers, in hours. Same day is zero.
 *
 * A fixed set on the control and an integer in the column. The band is a
 * rendering of the number rather than a fact about it — "24h" and "next day"
 * are one promise written twice — so a new band is a string, not a migration.
 * The stored value is validated against this list on write and rendered
 * generically if an older one survives.
 *
 * It stops at a week. Past that a delivery promise has stopped describing
 * delivery and started describing a lead time, which is a product's field and
 * already has one.
 */
export const LEAD_TIME_CHOICES = [0, 24, 48, 72, 168] as const;
export type LeadTimeChoice = (typeof LEAD_TIME_CHOICES)[number];

export const LEAD_TIME_MAX = 336;

export function isLeadTimeChoice(hours: number): hours is LeadTimeChoice {
  return (LEAD_TIME_CHOICES as readonly number[]).includes(hours);
}

/** Whether the column would accept this at all. The CHECK, in TypeScript. */
export function isStorableLeadTime(hours: number): boolean {
  return Number.isInteger(hours) && hours >= 0 && hours <= LEAD_TIME_MAX;
}

/* ── The scope ───────────────────────────────────────────────────────────── */

/**
 * One row covers an area, or a whole emirate.
 *
 * Both scales are real and both come from the taxonomy. A supplier delivering
 * anywhere in Dubai should not have to name forty areas to say so, and one who
 * only serves Al Quoz should not have to claim the emirate to be listed at all.
 *
 * The board's render carries a `Northern Emirates · 48h` chip, which is neither
 * — it is a colloquial grouping of four emirates with no row behind it in any
 * table a buyer filters on. It is expressible here as four chips, and that is
 * the honest version: the buyer filtering for Ras Al Khaimah has to match
 * something, and "Northern Emirates" is not a thing they can pick.
 */
export interface CoverageScope {
  emirate: Emirate;
  /** Null covers the emirate entire. */
  areaId: string | null;
}

export function sameScope(a: CoverageScope, b: CoverageScope): boolean {
  return a.areaId === null && b.areaId === null
    ? a.emirate === b.emirate
    : a.areaId === b.areaId;
}

/**
 * Whether this scope is already claimed, at either scale.
 *
 * Two rows can overlap without being equal: `Dubai` and `Al Quoz, Dubai` are
 * different scopes and the database's two partial unique indexes accept both.
 * That is on purpose — a supplier can deliver across Dubai in 48 hours and into
 * Al Quoz the same day, and refusing the pair would make the finer promise
 * unsayable.
 *
 * What is refused is the *same* scope twice, which is what a seller produces by
 * clicking Dubai a second time.
 */
export function alreadyCovered(
  existing: readonly CoverageScope[],
  scope: CoverageScope,
): boolean {
  return existing.some((row) => sameScope(row, scope));
}

/**
 * Redundant, not refused.
 *
 * An area row promising the same hours as its emirate's row says nothing the
 * emirate row does not, and the screen says so rather than blocking the save.
 * A seller narrowing a promise is doing something meaningful; a seller
 * repeating one has made a tidy-up, and refusing it would read as a bug.
 */
export function isRedundant(
  existing: readonly (CoverageScope & { leadTimeHours: number })[],
  candidate: CoverageScope & { leadTimeHours: number },
): boolean {
  if (candidate.areaId === null) return false;
  return existing.some(
    (row) =>
      row.areaId === null &&
      row.emirate === candidate.emirate &&
      row.leadTimeHours === candidate.leadTimeHours,
  );
}

/**
 * The order the chips read in: emirate-wide promises first, then areas, and
 * within each the faster promise first.
 *
 * A supplier's broadest claim is the one a buyer needs to see first, and the
 * fast promise is the one they are selling.
 */
export function orderCoverage<T extends CoverageScope & { leadTimeHours: number }>(
  rows: readonly T[],
  areaName: (areaId: string) => string,
): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.areaId !== null) - Number(b.areaId !== null) ||
      a.leadTimeHours - b.leadTimeHours ||
      a.emirate.localeCompare(b.emirate) ||
      (a.areaId && b.areaId ? areaName(a.areaId).localeCompare(areaName(b.areaId)) : 0),
  );
}
