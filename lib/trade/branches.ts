import { openNow, type OpenState } from "./open-now";
import { nextRamadan, type RamadanCalendar } from "./hours";
import { haversineKm } from "@/lib/geo/distance";
import type { Emirate, LocationType } from "@/lib/db/generated/enums";

/**
 * The branches page reduced to decisions, with no React and no database.
 *
 * Board 1f asks two questions and everything on the page answers one of them:
 * **can I get there today**, and **can I get it today**. Both are computed from
 * rows the storefront query already loads, so this module takes locations and
 * returns what to render rather than issuing queries of its own.
 *
 * Pure so the interesting rules are testable without a page: the Dubai clock,
 * the ordering fallback, the closure window and the non-stocking branch are all
 * things that are wrong in ways a screenshot does not show.
 */

/** What the badge on a branch row says. */
export type BranchStatus =
  /* A branch you cannot collect from. The type is the useful fact, not the hours. */
  | { kind: "type"; type: LocationType }
  | { kind: "open"; until?: string }
  /**
   * `opensAt` is a time later today or later this week, from the hours.
   * `until` is a date, from a closure window — the two never both apply, and a
   * closure that reported "opens 08:00" would be describing a door that is not
   * going to open at eight.
   */
  | { kind: "closed"; opensAt?: string; until?: Date }
  | { kind: "unknown" };

export interface BranchLocation {
  id: string;
  type: LocationType;
  emirate: Emirate;
  addressLine: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  whatsapp: string | null;
  hours: unknown;
  ramadanHours: unknown;
  serviceRadiusKm: number | null;
  closedFrom: Date | null;
  closedUntil: Date | null;
  closureReason: string | null;
  area: { name: string; isFreeZone: boolean };
}

/**
 * Where a buyer can actually collect goods.
 *
 * Only `sales_office` is out, and the line is drawn there rather than by
 * guessing: a workshop has parts, a depot and a warehouse hold stock, a head
 * office in this market is usually attached to one. An office is the single
 * type where turning up with a van is a wasted trip, which is the whole reason
 * criterion 6 exists — "a buyer must not drive to an office expecting a trade
 * counter".
 */
export function isStocking(type: LocationType): boolean {
  return type !== "sales_office";
}

/** An active temporary closure, or null. Board 3d writes these; 1f renders them. */
export function activeClosure(
  location: Pick<BranchLocation, "closedFrom" | "closedUntil" | "closureReason">,
  now: Date,
): { from: Date; until: Date; reason: string } | null {
  const { closedFrom, closedUntil, closureReason } = location;
  if (!closedFrom || !closedUntil || !closureReason) return null;
  if (now < closedFrom || now > closedUntil) return null;
  return { from: closedFrom, until: closedUntil, reason: closureReason };
}

/**
 * The badge, in priority order.
 *
 * A closure outranks the hours: a counter shut for a fit-out is not "Open now"
 * because its Monday shift says 08:00–18:00, and saying so would send somebody
 * to a locked door with the page's blessing.
 *
 * A non-stocking branch outranks both. Its hours still render in the row's mono
 * line — an office is worth phoning during its hours — but the badge carries
 * the fact that changes the buyer's plan.
 */
export function branchStatus(
  location: BranchLocation,
  now: Date,
  /** The platform's Ramadan calendar. Omitted, the compiled estimates apply. */
  calendar?: RamadanCalendar,
): BranchStatus {
  if (!isStocking(location.type)) return { kind: "type", type: location.type };
  const closure = activeClosure(location, now);
  // Criterion 7 forbids a bare "Closed". A closure's answer is a date, not a time.
  if (closure) return { kind: "closed", until: closure.until };

  const state: OpenState = openNow(
    location.hours as never,
    location.ramadanHours as never,
    now,
    calendar,
  );
  if (state.state === "open") return { kind: "open", until: state.until };
  if (state.state === "closed") {
    /*
       "Closed" alone is a dead end. `openNow` walks forward through the week to
       find the next shift, so a Friday evening on a Mon–Thu counter reports
       Monday's opening rather than nothing — criterion 7, "computed correctly
       across a weekend".
    */
    return state.opensAt ? { kind: "closed", opensAt: state.opensAt } : { kind: "closed" };
  }
  return { kind: "unknown" };
}

/** Is the Ramadan week in effect right now? Drives the strip, once, for the page. */
export function ramadanActive(
  now: Date,
  calendar?: RamadanCalendar,
): { from: Date; to: Date } | null {
  const window = nextRamadan(now, calendar);
  return window?.active ? { from: window.from, to: window.to } : null;
}

export type BranchSort = "distance" | "emirate";

export interface OrderedBranches {
  sort: BranchSort;
  branches: BranchLocation[];
  /** Kilometres to each branch, by id. Absent entries are unpinned or unsorted. */
  distanceKm: Record<string, number>;
}

/**
 * The order the column is read in.
 *
 * With an origin, nearest first — the buyer asked "which of these is closest to
 * me" and any other answer ignores the question. Unpinned branches cannot be
 * measured, so they fall to the end rather than being dropped: the address is
 * still useful, and a location with no coordinates is never approximated to an
 * area centroid anywhere on this platform.
 *
 * Without one, the head office leads and the rest group by emirate. That is the
 * fallback criterion 8 requires when geolocation is declined, and it is also the
 * default on first paint — the page is server-rendered and the server does not
 * know where the buyer is.
 */
export function orderBranches(
  locations: readonly BranchLocation[],
  origin: { lat: number; lng: number } | null,
): OrderedBranches {
  const distanceKm: Record<string, number> = {};

  if (origin) {
    for (const location of locations) {
      if (location.lat == null || location.lng == null) continue;
      distanceKm[location.id] = haversineKm(origin, {
        lat: location.lat,
        lng: location.lng,
      });
    }
    const branches = [...locations].sort((a, b) => {
      const left = distanceKm[a.id];
      const right = distanceKm[b.id];
      if (left == null && right == null) return 0;
      // Unmeasurable last, both directions, so the comparator stays consistent.
      if (left == null) return 1;
      if (right == null) return -1;
      return left - right;
    });
    return { sort: "distance", branches, distanceKm };
  }

  /*
     Emirates in the same order the header sub-line lists them: most branches
     first. Alphabetical by enum name was the first version and read badly — a
     Dubai supplier with three Dubai branches had them at ranks 1, 4 and 5,
     split apart by single branches in Abu Dhabi and Ajman that sort earlier on
     the letter "a". The column and the sub-line now agree, which is the point
     of both.
  */
  const { emirates } = emirateSummary(locations, Number.POSITIVE_INFINITY);
  const rank = new Map(emirates.map((emirate, index) => [emirate, index]));

  const branches = [...locations].sort((a, b) => {
    if (a.type === "head_office" && b.type !== "head_office") return -1;
    if (b.type === "head_office" && a.type !== "head_office") return 1;
    return (
      (rank.get(a.emirate) ?? 0) - (rank.get(b.emirate) ?? 0) ||
      a.area.name.localeCompare(b.area.name)
    );
  });
  return { sort: "emirate", branches, distanceKm };
}

/**
 * The header sub-line: "4 branches · Dubai, Sharjah, Abu Dhabi".
 *
 * Descending branch count, capped at three with the remainder counted rather
 * than listed. A supplier in seven emirates has a sub-line that wraps and stops
 * being scannable, and the three they have most branches in is the part a buyer
 * uses to decide whether this supplier is near them at all.
 */
export function emirateSummary(
  locations: readonly BranchLocation[],
  cap = 3,
): { emirates: Emirate[]; more: number } {
  const counts = new Map<Emirate, number>();
  for (const location of locations) {
    counts.set(location.emirate, (counts.get(location.emirate) ?? 0) + 1);
  }
  const ordered = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([emirate]) => emirate);
  return { emirates: ordered.slice(0, cap), more: Math.max(0, ordered.length - cap) };
}

export interface Coverage {
  /** The widest radius any branch delivers to, if any branch states one. */
  radiusKm: number | null;
  /** The seller's own delivery promise. Free text; theirs, not ours. */
  note: string | null;
  freeZone: boolean;
}

/**
 * The delivery card — the answer to "can I get it today" for a buyer who cannot
 * travel, which is why it sits on the map rather than in a tooltip.
 *
 * Nothing here is claimed on the supplier's behalf. The radius is the widest one
 * a branch states, the note is the seller's own words, and a business that has
 * said neither gets no card rather than a reassuring sentence we invented. The
 * render's "Delivers UAE-wide" is a seller's claim, not a derivation, and it
 * belongs in the note where a seller wrote it.
 */
export function coverageOf(
  locations: readonly BranchLocation[],
  deliveryNote: string | null,
): Coverage | null {
  const radii = locations
    .map((location) => location.serviceRadiusKm)
    .filter((km): km is number => km != null);
  const radiusKm = radii.length ? Math.max(...radii) : null;
  const note = deliveryNote?.trim() ? deliveryNote.trim() : null;
  const freeZone = locations.some((location) => location.area.isFreeZone);
  if (radiusKm === null && note === null) return null;
  return { radiusKm, note, freeZone };
}
