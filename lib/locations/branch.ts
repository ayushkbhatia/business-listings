import type { GeocodePrecision } from "@/lib/db/generated/enums";

/**
 * What a branch's two state columns mean, and what each one costs.
 *
 * Board 3c's own framing: the screen showed five words across two columns —
 * `Published`/`Hidden`/`Draft` and `Exact`/`Approx`/`Missing` — and said
 * nothing about any of them. They are independent axes. A hidden branch can
 * have a perfect pin and a published one can have none.
 *
 * No database and no `server-only` above it, for the reason
 * `lib/onboarding/branch-fields.ts` has neither: the table and the map rail run
 * in the browser and need the same derivations the server does. One definition,
 * two runtimes.
 */

/* ── Axis one: who can see it ────────────────────────────────────────────── */

export const BRANCH_STATUSES = ["published", "hidden", "draft"] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export interface BranchVisibility {
  published: boolean;
  /** Null on a branch that has never been live. */
  publishedAt: Date | null;
}

/**
 * Three states out of a boolean and a date, rather than a status column.
 *
 * `published` stays the one answer to "can buyers see this", because every
 * query that filters branches already asks it that way and a second column
 * saying the same thing is a second column to keep in step. What the boolean
 * cannot say is *why* a branch is not live, and the two answers have different
 * consequences one screen over: board 3d offers a hidden branch in its picker
 * and skips a draft.
 *
 * The split falls out of one fact — has this ever been live — which is a date.
 * A branch taken down was live once and is **hidden**; one that never was is a
 * **draft**.
 *
 * The consequence worth naming: there is no way back to `draft`. Un-hiding and
 * re-hiding a branch leaves it hidden, for ever. That is correct rather than a
 * limitation — the two states are identical to a buyer, and the only thing that
 * reads the difference wants to know whether this branch has ever made a claim
 * to anybody. It has.
 */
export function branchStatus(branch: BranchVisibility): BranchStatus {
  if (branch.published) return "published";
  return branch.publishedAt === null ? "draft" : "hidden";
}

/** Board 3d's picker: a draft branch has no buyers to make claims to. */
export function offeredForHours(branch: BranchVisibility): boolean {
  return branchStatus(branch) !== "draft";
}

/* ── Axis two: how findable it is ────────────────────────────────────────── */

export const PIN_STATES = ["exact", "approximate", "missing"] as const;
export type PinState = (typeof PIN_STATES)[number];

export interface BranchPin {
  lat: number | null;
  lng: number | null;
  geocodePrecision: GeocodePrecision | null;
}

/**
 * `missing` is the absence of coordinates, not a stored precision.
 *
 * The database holds two values because there are two ways a pin can be placed;
 * there is a third way for it to be *absent*, and that one is already recorded
 * by the coordinates being null. A CHECK ties the pair together, so the
 * fallback below is narrowing rather than a real branch — a row cannot carry
 * coordinates and no precision.
 */
export function pinState(branch: BranchPin): PinState {
  if (branch.lat === null || branch.lng === null) return "missing";
  return branch.geocodePrecision ?? "approximate";
}

/**
 * Criterion 3, as a predicate: **only an exact pin may be measured.**
 *
 * An approximate pin is the area's centre, so a distance computed from it is
 * the distance to the area and is presented as the distance to the address.
 * That is not a small error — the areas in this taxonomy run to several
 * kilometres across, and the whole of `near me` is a sort on differences that
 * size.
 *
 * It is filtered here rather than at each call site so that the two consumers
 * — the search ranking's `nearestKm` and board 1f's branch order — cannot
 * disagree about which branches have a measurable position. Both already treat
 * an unmeasurable branch as unknown rather than far, which is why dropping the
 * number is cheaper than keeping a made-up one.
 */
export function measurable<T extends BranchPin>(branches: readonly T[]): T[] {
  return branches.filter((branch) => pinState(branch) === "exact");
}

/* ── The header, the overlay and the table, reconciled ───────────────────── */

export interface BranchCounts {
  /** Every branch, whatever its status. The table's row count. */
  total: number;
  /** Published. What the header means by "shown to buyers". */
  shown: number;
  /** Carrying coordinates, of any precision. The map's marker count. */
  pinned: number;
  /** The rest. */
  missing: number;
}

/**
 * Criterion 1: the header count, the table row count and the map overlay count
 * reconcile.
 *
 * They did not on the board — `4 branches` sat over five rows while the overlay
 * counted `4 PINS · 1 MISSING`, four pins *of* five branches. Two arithmetics
 * over one table, neither stated. One function now produces all three, so a
 * later change to what "shown" means moves the header and the overlay together
 * or moves neither.
 */
export function branchCounts(
  branches: readonly (BranchVisibility & BranchPin)[],
): BranchCounts {
  const pinned = branches.filter((branch) => pinState(branch) !== "missing").length;
  return {
    total: branches.length,
    shown: branches.filter((branch) => branchStatus(branch) === "published").length,
    pinned,
    missing: branches.length - pinned,
  };
}

/* ── The rail's issue card ───────────────────────────────────────────────── */

export interface PinIssue {
  id: string;
  name: string;
  state: Exclude<PinState, "exact">;
}

/**
 * One row per pin problem, worst first.
 *
 * A missing pin outranks an approximate one because the costs are not the same
 * size: an unpinned branch is absent from map search altogether, while an
 * approximate one still appears everywhere a buyer browses by area and only
 * loses the distance sort.
 *
 * Draft branches are included. A seller who has not finished a branch still
 * needs to be told what it is missing — that is what the card is for — and
 * excluding them would make the card go quiet at exactly the moment it has
 * something to say.
 *
 * When it is empty the card does not render. Board 3c's third state:
 * *"a card saying everything is fine is noise"*.
 */
export function pinIssues(
  branches: readonly { id: string; name: string; pin: PinState }[],
): PinIssue[] {
  const issues: PinIssue[] = [];
  for (const branch of branches) {
    if (branch.pin !== "exact") issues.push({ id: branch.id, name: branch.name, state: branch.pin });
  }
  return issues.sort((a, b) => (a.state === b.state ? 0 : a.state === "missing" ? -1 : 1));
}
