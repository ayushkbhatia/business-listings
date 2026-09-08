import type { StrengthItem, WeightKey } from "@/lib/metrics/profile-strength";
import { PHOTO_MINUTES, PHOTO_TARGET } from "@/lib/photos/targets";

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

export const SETUP_TASKS = ["photos", "products", "team"] as const;
export type SetupTaskId = (typeof SETUP_TASKS)[number];

/**
 * Which lever a card pays into.
 *
 * Every task pays into one, which is new. The site visit was the exception —
 * it moved verification tier rather than profile strength, so its chip read
 * "no points" — and it was also why this hub could never be finished: that task
 * closed on our scheduling rather than on the seller's own work, so `openCount`
 * never reached zero and the completion redirect never fired. It was withdrawn
 * as a product, and the nullable half of this type went with it.
 */
const LEVER_OF: Record<SetupTaskId, WeightKey> = {
  photos: "photos",
  products: "catalogue",
  team: "team",
};

/** The levers no card offers. Named so the page can say what else counts. */
export const LEVERS_WITHOUT_TASK: readonly WeightKey[] = ["identity", "filterableSpecs"];

/*
   Targets and estimates are the ones `lib/onboarding/service.ts` already
   publishes. Two hubs describing the same four jobs must not disagree about
   when one is finished or how long it takes, and the seller sees both.
*/
const TARGETS: Record<SetupTaskId, number> = {
  /*
     From lib/photos/targets.ts, not typed again here.

     The hub's card and board 8b's own heading state this number to the same
     seller minutes apart. They disagreed the moment both existed — six here
     against five there — and a seller told they had finished on one screen and
     not on the other stops believing both.
  */
  photos: PHOTO_TARGET,
  products: 10,
  team: 2,
};

const MINUTES: Record<SetupTaskId, number> = {
  photos: PHOTO_MINUTES,
  products: 25,
  team: 3,
};

export interface SetupTaskFacts {
  /** Media on the business or its products, review photographs excluded. */
  photos: number;
  products: number;
  /** Seats on the listing, the owner included. */
  seats: number;
  /**
   * Invitations sent and still outstanding.
   *
   * Board 8d §5: the task ticks **on send**, because the seller cannot control
   * whether a colleague accepts and a task left open by somebody else's
   * inaction is a bad task. `profile_score` still wants an active seat for its
   * points, so the checkbox and the meter legitimately disagree while an
   * invitation sits unaccepted — which the invite screen states in a line
   * rather than letting the seller discover it.
   */
  invitesSent: number;
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
    team: facts.seats + facts.invitesSent,
  };

  const tasks: SetupTaskRow[] = SETUP_TASKS.map((id) => {
    const done = got[id] >= TARGETS[id];

    const item = byLever.get(LEVER_OF[id]);

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
// Days
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Dubai calendar day an instant falls in, as the UTC midnight Prisma stores
 * a `@db.Date` at.
 *
 * `ListingViewDay.day` is bucketed in Asia/Dubai — "the day the supplier had" —
 * so comparing it against a raw `publishedAt` would drop the day a listing went
 * live whenever it went live before 4am Dubai, and would do it silently on a
 * rail whose whole job is to say views are already arriving.
 *
 * Re-exported rather than defined. This and `dubaiDay` in
 * `lib/telemetry/record.ts` were the same function in two files — the read and
 * write sides of one column — with a comment naming `lib/format/date.ts` as the
 * home and calling the move a follow-up. Board `3l` was the third caller.
 */
export { dubaiDayStart } from "@/lib/format";

