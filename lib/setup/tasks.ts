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

/**
 * Board `8a-s`'s four, in weight order — credentials first, photographs last.
 *
 * Four where goods has three, and the order is weight × impact, the same rule
 * `8a` follows. Here the two agree: what makes a buyer trust an audit practice
 * is the FTA agent number and the indemnity cover, and a picture of the office
 * is the least of it.
 *
 * Photographs are last **on purpose**, and the card says why: three is plenty,
 * it is worth the least of the four, and it costs the most time per point of
 * anything on the screen.
 */
export const SERVICES_TASKS = ["credentials", "services", "team", "photos"] as const;

/**
 * A seller who is both gets the union, deduplicated — `8a-s` B9.
 *
 * Five cards, which is the longest this screen ever gets. Ordered by what each
 * is worth on the renormalised table rather than by either list's own order, so
 * the rule "largest remaining weight first" still holds across a set neither
 * board drew.
 */
export const BOTH_TASKS = [
  "credentials",
  "products",
  "services",
  "team",
  "photos",
] as const;

export type SetupTaskId =
  | (typeof SETUP_TASKS)[number]
  | (typeof SERVICES_TASKS)[number]
  | (typeof BOTH_TASKS)[number];

export type SetupKind = "unset" | "goods" | "services" | "both";

/** Which cards this seller is offered. `unset` is what every listing had. */
export function tasksFor(kind: SetupKind): readonly SetupTaskId[] {
  if (kind === "services") return SERVICES_TASKS;
  if (kind === "both") return BOTH_TASKS;
  return SETUP_TASKS;
}

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
const LEVER_OF: Record<SetupTaskId, string> = {
  photos: "photos",
  products: "catalogue",
  team: "team",
  /*
     Board `8a-s`. Both of these pay into a lever that only exists on the
     services table, which is why `SetupLever.key` is a string rather than a
     `WeightKey`: the two tables do not share a key set, and a type that
     pretended they did would be a type nobody could add a component to.
  */
  credentials: "credentials",
  services: "services",
};

/**
 * The levers no card offers. Named so the page can say what else counts.
 *
 * `licence` is on this list for a reason worth stating: it is the one component
 * a seller cannot finish on their own — `verificationTier` is writable only by
 * an `ops_lead`, which is `CLAUDE.md` non-negotiable 2 — so it is named as a
 * lever and never offered as a task. That is why the services table's other six
 * components sum to exactly eighty, the threshold: a practice that does
 * everything on the hub lands on it, with nothing they can act on left unsaid.
 */
export const LEVERS_WITHOUT_TASK: readonly string[] = [
  "identity",
  "filterableSpecs",
  "licence",
  "coverage",
];

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
  /*
     Two credentials, and "on file" rather than "verified".

     Board `8a-s`'s completion rule asks for at least one *verified* credential,
     and this product has no such state: board 3e splits its screen precisely so
     that a document the seller uploaded reads `On file` and never `Verified`,
     because nobody here has looked at it. A task that cannot be finished by the
     seller's own work is the defect the site-visit cut was made to remove.
  */
  credentials: 2,
  services: 3,
};

/**
 * Photographs, where a practice is asked for three and a trader for ten.
 *
 * The same key with a different target, which is why it is a table rather than
 * a constant: `8a-s` task 4 asks for three and says three is plenty, and
 * holding a services seller to a parts supplier's gallery would be the goods
 * hub's number wearing the services hub's copy.
 */
const SERVICES_TARGETS: Partial<Record<SetupTaskId, number>> = {
  photos: 3,
};

const MINUTES: Record<SetupTaskId, number> = {
  photos: PHOTO_MINUTES,
  products: 25,
  team: 3,
  credentials: 5,
  services: 4,
};

/**
 * The services estimates, and they have to sum to the figure in the heading —
 * `8a-s` criterion 10. Five, four, two and four is fifteen, which is what the
 * hero says. The goods numbers are larger because the jobs are: ten
 * photographs of a warehouse is not three of an office wall.
 */
const SERVICES_MINUTES: Partial<Record<SetupTaskId, number>> = {
  photos: 4,
  team: 2,
};

export interface SetupTaskFacts {
  /** Which table this seller is measured against — board `8a-s` B1. */
  kind?: SetupKind;
  /** Credentials on file and not lapsed. Zero for a seller of goods. */
  credentials?: number;
  /** Scope sheets with `status = live`. Zero for a seller of goods. */
  servicesLive?: number;
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
  /** A key of whichever weight table this seller is measured against. */
  key: string;
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
  const kind = facts.kind ?? "goods";
  const services = kind === "services" || kind === "both";

  const got: Record<SetupTaskId, number> = {
    photos: facts.photos,
    products: facts.products,
    team: facts.seats + facts.invitesSent,
    credentials: facts.credentials ?? 0,
    services: facts.servicesLive ?? 0,
  };

  const targetOf = (id: SetupTaskId) =>
    (services ? SERVICES_TARGETS[id] : undefined) ?? TARGETS[id];
  const minutesOf = (id: SetupTaskId) =>
    (services ? SERVICES_MINUTES[id] : undefined) ?? MINUTES[id];

  const tasks: SetupTaskRow[] = tasksFor(kind).map((id) => {
    const target = targetOf(id);
    const done = got[id] >= target;

    const item = byLever.get(LEVER_OF[id]);

    return {
      id,
      done,
      progress: { got: got[id], target },
      /*
         What this seller would still gain, not the component's whole weight.

         Board `8a-s` B3 asks for the full weight on the badge so that the four
         badges sum to a hundred. This keeps the shipped behaviour, and the
         reason is written twice already in this repository — here, and on the
         onboarding meter: *"showing the weight would tell a seller who has done
         half of something that they can earn it all again"*. A seller reads one
         card and asks what they get for doing it; nobody sums badges. The full
         weights are on the screen, in the weights card, which is where a table
         belongs.
      */
      points: done ? 0 : (item?.remaining ?? 0),
      minutes: minutesOf(id),
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

