/**
 * Board 6f's status vocabulary and its opportunity metric.
 *
 * Pure, and deliberately so: the matrix table renders these on the client, the
 * queues count them on the server, and the CRM hand-off to board 12d sorts by
 * them. One computation, and nothing here touches a database.
 *
 * The board used one badge, "Queued", for two opposite situations — a page with
 * supply and no copy, and a page with demand and no supply. Those route to
 * different teams, which is the whole reason the vocabulary exists.
 */

/**
 * Searches a month above which a shortfall is worth recruiting against.
 *
 * The one number in board 6f that is not on the rules panel. It does not decide
 * whether a page exists — it decides whether a shortfall is shown to a sales
 * team as work or shown to nobody as arithmetic — so a wrong value costs a
 * misdirected week rather than an index. A constant with its reasoning beside
 * it until somebody has evidence for a different one.
 */
export const RECRUIT_SEARCHES = 1_000;

export type PageStatus =
  /** Published, above every floor, copy above the word floor. */
  | "live"
  /** Published and live, but its copy is under the current word floor. */
  | "live_thin_copy"
  /** Supply is there and nobody has written the page. */
  | "queued_copy"
  /** Below its need, with enough search demand to be worth recruiting into. */
  | "recruit"
  /** Below its need, and not enough demand to spend a call on. */
  | "held_supply"
  /** A person said not to publish this one. */
  | "held_editorial";

/** Who works a row in this state, and what the action is. */
export const STATUS_OWNER: Record<PageStatus, "none" | "content_ops" | "ops_crm" | "editorial"> = {
  live: "none",
  live_thin_copy: "content_ops",
  queued_copy: "content_ops",
  recruit: "ops_crm",
  held_supply: "none",
  held_editorial: "editorial",
};

export interface StatusInput {
  /** Published by staff, held by nobody, and holding its floors or its window. */
  live: boolean;
  heldAt: Date | null;
  listings: number;
  /** The higher of the absolute and demand-relative floors. */
  need: number;
  introWords: number;
  minIntroWords: number;
  /** Null where nobody has recorded a figure. Never read as nought. */
  monthlySearches: number | null;
}

export interface PageState {
  status: PageStatus;
  /** Listings still needed. Nought once the page meets its need. */
  shortfall: number;
  /**
   * Monthly searches ÷ listings still needed — board 6f §opportunity.
   *
   * Demand unlocked per supplier recruited, not raw demand and not raw
   * shortfall. It ranks Jumeirah — two short of 2,260 searches a month — above
   * Business Bay, which needs 21 for 3,940, and that is the correct order to
   * work: a shortfall-weighted score puts near-empty low-demand areas first and
   * raw volume puts pages that are almost there last.
   *
   * Nought where the page meets its need, and nought where no figure exists.
   * An unmeasured scope is not a zero-opportunity scope, but it is not a
   * rankable one either, and inventing a number for it would decide where a
   * sales team spends its week by accident.
   */
  opportunity: number;
}

export function pageState(input: StatusInput): PageState {
  const shortfall = Math.max(0, input.need - input.listings);
  const opportunity =
    shortfall === 0 || input.monthlySearches === null ? 0 : input.monthlySearches / shortfall;

  return { status: statusOf(input, shortfall), shortfall, opportunity };
}

function statusOf(input: StatusInput, shortfall: number): PageStatus {
  // A person's decision outranks the arithmetic, because it was made knowing it.
  if (input.heldAt !== null) return "held_editorial";

  if (input.live) {
    return input.introWords >= input.minIntroWords ? "live" : "live_thin_copy";
  }

  /*
     Supply is there and the page is not. That is a writer's afternoon, so it
     goes to content ops rather than into the recruitment queue — the mistake
     the board's single "Queued" badge made in both directions.
  */
  if (shortfall === 0) return "queued_copy";

  /*
     Below need. Which queue depends on whether anybody would answer the call.

     A scope with no recorded demand lands in `held_supply`, not `recruit`:
     absent volume is not high volume, and the board is explicit that missing
     and zero produce opposite decisions.
  */
  return (input.monthlySearches ?? 0) >= RECRUIT_SEARCHES ? "recruit" : "held_supply";
}

/**
 * The queue order for the matrix and for the hand-off to board 12d.
 *
 * Opportunity descending; pages that meet their need score nought and fall to
 * the bottom, where the board says they sort by sessions. There is no sessions
 * figure in this product yet — no analytics import exists — so they sort by
 * recorded search volume instead, which is the same intent with the data that
 * is actually here. When sessions land, this is the one comparator to change.
 */
export function byOpportunity<T extends PageState & { monthlySearches: number | null }>(
  a: T,
  b: T,
): number {
  if (a.opportunity !== b.opportunity) return b.opportunity - a.opportunity;
  return (b.monthlySearches ?? 0) - (a.monthlySearches ?? 0);
}
