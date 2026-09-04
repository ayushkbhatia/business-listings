import { UAE_TIME_ZONE } from "@/lib/format/locale";
import type { StrengthItem, WeightKey } from "@/lib/metrics/profile-strength";

/**
 * Board 8a's four cards, worked out rather than written down.
 *
 * Pure on purpose. Everything here is arithmetic over facts the service has
 * already loaded, so the numbers the hub publishes — what a task is worth, how
 * many are left, how long they take — are unit-testable without a database.
 *
 * ## The chips are this seller's own arithmetic
 *
 * The board draws "+12%" on a card. A constant would be wrong for almost
 * everybody: a supplier with six photographs already has fewer points left in
 * photographs than one with none, and a chip that promises the same twelve to
 * both is the meter lying to the person who has done the most work. So `points`
 * comes from the matching `StrengthItem.remaining` — the whole-point shares
 * `strengthItems` distributes, which sum with `earned` to exactly a hundred.
 *
 * A done task's chip is zero, clamped rather than computed. The photographs
 * lever runs to ten (counting the logo and the cover) while the card asks for
 * six, so a seller can finish the card with points still on the table; the
 * levers list below is where those stay named, rather than a card that says
 * "Done" and "+8%" in the same breath.
 *
 * ## Why the levers come back too
 *
 * The four cards carry fifty points between them against a denominator of a
 * hundred. Without naming the rest, a seller finishes everything on offer and
 * sits at fifty with nothing to do about it — the exact state
 * `lib/metrics/profile-strength.ts` says a completeness meter must never reach.
 * `identity` and `filterableSpecs` have no card at all, so they would otherwise
 * be invisible; every lever is returned, flagged with whether a card offers it.
 */

export const SETUP_TASKS = ["photos", "products", "team", "visit"] as const;
export type SetupTaskId = (typeof SETUP_TASKS)[number];

/**
 * Which lever a card pays into. The visit pays into none — it moves
 * verification tier, which is platform-owned and not on this meter — so its
 * chip reads "no points" rather than implying a number it will not deliver.
 */
const LEVER_OF: Record<SetupTaskId, WeightKey | null> = {
  photos: "photos",
  products: "catalogue",
  team: "team",
  visit: null,
};

/** The levers no card offers. Named so the page can say what else counts. */
export const LEVERS_WITHOUT_TASK: readonly WeightKey[] = ["identity", "filterableSpecs"];

/*
   Targets and estimates are the ones `lib/onboarding/service.ts` already
   publishes. Two hubs describing the same four jobs must not disagree about
   when one is finished or how long it takes, and the seller sees both.
*/
const TARGETS: Record<SetupTaskId, number> = {
  photos: 6,
  products: 10,
  team: 2,
  visit: 1,
};

const MINUTES: Record<SetupTaskId, number> = {
  photos: 10,
  products: 25,
  team: 3,
  visit: 2,
};

export interface SetupTaskFacts {
  /** Media on the business or its products, review photographs excluded. */
  photos: number;
  products: number;
  /** Seats on the listing, the owner included. */
  seats: number;
  /** Site visits asked for and not withdrawn. */
  visitRequests: number;
  /** From `strengthItems`, so the chips and the meter cannot drift apart. */
  items: readonly StrengthItem[];
}

export interface SetupTaskRow {
  id: SetupTaskId;
  done: boolean;
  /** "3 of 10", for the card's own progress line. */
  progress: { got: number; target: number };
  /** Whole points this seller would still gain here. Zero once it is done. */
  points: number;
  minutes: number;
}

export interface SetupLever {
  key: WeightKey;
  earned: number;
  remaining: number;
  /** The lever's whole weight in points. `earned + remaining`, always. */
  total: number;
  /** False for the two the four cards do not cover. */
  hasTask: boolean;
}

export interface SetupBoard {
  tasks: SetupTaskRow[];
  levers: SetupLever[];
  /** So the hero heading counts what is actually on screen. */
  openCount: number;
  openMinutes: number;
  doneCount: number;
}

/**
 * The four rows, the five levers, and the two totals the hero is written from.
 *
 * `openCount` and `openMinutes` are derived here rather than in the page for
 * one reason: the heading reads "Three things left, about 38 minutes" and a
 * page that counted them itself would eventually say four over three cards.
 */
export function setupBoard(facts: SetupTaskFacts): SetupBoard {
  const byLever = new Map(facts.items.map((item) => [item.key, item]));

  const got: Record<SetupTaskId, number> = {
    photos: facts.photos,
    products: facts.products,
    team: facts.seats,
    visit: facts.visitRequests,
  };

  const tasks: SetupTaskRow[] = SETUP_TASKS.map((id) => {
    const done = got[id] >= TARGETS[id];
    const lever = LEVER_OF[id];
    const item = lever === null ? undefined : byLever.get(lever);

    return {
      id,
      done,
      progress: { got: got[id], target: TARGETS[id] },
      points: done ? 0 : (item?.remaining ?? 0),
      minutes: MINUTES[id],
    };
  });

  const levers: SetupLever[] = facts.items.map((item) => ({
    key: item.key,
    earned: item.earned,
    remaining: item.remaining,
    total: item.earned + item.remaining,
    hasTask: !LEVERS_WITHOUT_TASK.includes(item.key),
  }));

  const open = tasks.filter((task) => !task.done);

  return {
    tasks,
    levers,
    openCount: open.length,
    openMinutes: open.reduce((total, task) => total + task.minutes, 0),
    doneCount: tasks.length - open.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The site-visit fee
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `AED 750` is drawn on board 8a and its own open question 2 says the figure is
 * unconfirmed against the pricing page. A setting is the right answer to an
 * unconfirmed number: correcting it costs a row rather than a deploy, and
 * CLAUDE.md is explicit that content belongs in the database.
 *
 * The key and the fallback live in this pure module, not beside the read, so a
 * seed can write the row without importing a `server-only` file — the same
 * split `lib/trade/hours.ts` and `lib/trade/ramadan-calendar.ts` make.
 */
export const SITE_VISIT_FEE_SETTING_KEY = "site_visit_fee_aed";

/** What board 8a draws, until somebody confirms it against pricing. */
export const FALLBACK_SITE_VISIT_FEE_AED = 750;

/** Whole dirhams, no higher than a plan costs in a year. */
const FEE_CEILING_AED = 100_000;

/**
 * `750` → 750. Anything else → null, and the caller uses the compiled figure.
 *
 * A string is accepted because the admin settings screen posts a form field and
 * `"750"` in a Json column is the likeliest way this row gets written. A
 * fraction is not: the fee is quoted in whole dirhams on the card and frozen in
 * whole dirhams on the request row.
 */
export function parseSiteVisitFeeAed(value: unknown): number | null {
  // `Number("")` is zero, and an empty settings field read as a free site visit
  // is the wrong direction to be wrong in: a Free seller would be told the top
  // badge costs nothing.
  if (typeof value === "string" && value.trim() === "") return null;

  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) return null;
  if (parsed < 0 || parsed > FEE_CEILING_AED) return null;
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Days
// ─────────────────────────────────────────────────────────────────────────────

const DAY_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: UAE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The Dubai calendar day an instant falls in, as the UTC midnight Prisma stores
 * a `@db.Date` at.
 *
 * `ListingViewDay.day` is bucketed in Asia/Dubai — "the day the supplier had" —
 * so comparing it against a raw `publishedAt` would drop the day a listing went
 * live whenever it went live before 4am Dubai, and would do it silently on a
 * rail whose whole job is to say views are already arriving.
 */
export function dubaiDayStart(instant: Date): Date {
  const parts = DAY_PARTS.formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00.000Z`);
}
