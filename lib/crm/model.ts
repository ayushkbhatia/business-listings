/**
 * Board 12d — the rules of the call list, with no database.
 *
 * What a call outcome does to a task, when a task is due, which signal wins
 * when a business carries several, what the demand score is, and the supply
 * arithmetic the banner states. Everything the screen asserts about a row or a
 * number is decided here, so `tests/unit/crm-model.test.ts` can hold it without
 * a seeded database.
 *
 * Pure: no Prisma value import, no clock. The browser may read it.
 */

import { VERIFIED_TIER } from "../verification";
import { ceilShare } from "../publish-threshold";

const DAY_MS = 86_400_000;
const DUBAI_OFFSET_MS = 4 * 3_600_000;

/**
 * The window every signal count reads, except the week figure a script quotes.
 * Board 4f's upgrade window, so a cap refusal is recent on both boards at once.
 */
export const SIGNAL_WINDOW_DAYS = 30;

// ── Signals ──────────────────────────────────────────────────────────────────

export const CRM_SIGNALS = ["churn_risk", "cap_reached", "unclaimed_demand", "held_page", "zero_result"] as const;
export type CrmSignalKey = (typeof CRM_SIGNALS)[number];

/**
 * Which signal a business is called about when it carries several.
 *
 * One task per business, because a call opens with one number and a list that
 * gives the same person three reasons is a list somebody reads instead of
 * dialling. The order runs from what the account already is: a paying account
 * about to churn is a save call whatever else is true of it; a claimed account
 * at its cap is an upgrade call; an unclaimed listing buyers are writing to is a
 * stronger claim call than one that merely sits in a thin area page; and a
 * search that found nobody is the weakest evidence of the five.
 */
export function strongerSignal(a: CrmSignalKey, b: CrmSignalKey): CrmSignalKey {
  return CRM_SIGNALS.indexOf(a) <= CRM_SIGNALS.indexOf(b) ? a : b;
}

/** Which tab a signal belongs to beyond the call list, which shows them all. */
export const PIPELINE_SIGNALS: Readonly<Record<"upgrade" | "renewal", readonly CrmSignalKey[]>> = {
  upgrade: ["cap_reached"],
  renewal: ["churn_risk"],
};

/**
 * The facts each signal is derived with. Snapshotted onto the task at the run
 * that derived it, so the WHY THEM cell, the script and the banner render from
 * the same numbers the sort used.
 */
export type SignalFacts =
  | {
      kind: "held_page";
      areaId: string;
      areaName: string;
      categoryId: string;
      categoryName: string;
      path: string;
      listings: number;
      verified: number;
      need: number;
      minVerifiedShare: number;
      introWords: number;
      minIntroWords: number;
      /** Unverified listings in the scope — the pool a call can move. */
      unverified: number;
      /** Searches a month recorded for the scope, or null where none is. */
      monthlySearches: number | null;
      /** Every condition the page fails, supply and otherwise. */
      failing: readonly string[];
      /** Zero-result searches in this business's own trade and emirate, last 7 days. */
      tradeSearchesWeek: number;
      trade: string;
      /** Claimed when derived, so a claim afterwards can be told from one before. */
      claimed: boolean;
    }
  | {
      kind: "zero_result";
      categoryId: string;
      categoryName: string;
      searches30d: number;
      searchesWeek: number;
    }
  | { kind: "unclaimed_demand"; enquiries30d: number }
  | {
      kind: "cap_reached";
      cap: "enquiry_cap" | "product_cap" | "service_cap";
      missedEnquiries30d: number;
      /** The latest refusal at a product or service cap, where there is one. */
      refusedAt: string | null;
      refusedAttempted: number | null;
      refusedCap: number | null;
      planId: string | null;
    }
  | {
      kind: "churn_risk";
      replyRate: number;
      replySample: number;
      renewsAt: string;
      planId: string;
    };

/**
 * The sort key. Buyer demand at stake, in the signal's own unit, recomputed on
 * every run and never stored as anybody's priority (B2).
 *
 * One search and one enquiry count alike. That is a choice with a cost — an
 * enquiry is a buyer further along than a search — and it is left plain rather
 * than hidden behind a weight nobody measured. The owner's question, not this
 * function's.
 */
export function demandScoreOf(facts: SignalFacts): number {
  switch (facts.kind) {
    case "held_page":
      return facts.monthlySearches ?? 0;
    case "zero_result":
      return facts.searches30d;
    case "unclaimed_demand":
      return facts.enquiries30d;
    case "cap_reached":
      return facts.missedEnquiries30d;
    case "churn_risk":
      return unansweredOf(facts);
  }
}

/** Enquiries in board 4f's sample that went unanswered. */
export function unansweredOf(facts: { replyRate: number; replySample: number }): number {
  return Math.max(0, Math.round(facts.replySample * (1 - facts.replyRate)));
}

/** The number the WHY THEM cell and the script open with. */
export function signalValueOf(facts: SignalFacts): number {
  switch (facts.kind) {
    case "held_page":
      return facts.tradeSearchesWeek;
    case "zero_result":
      return facts.searches30d;
    case "unclaimed_demand":
      return facts.enquiries30d;
    case "cap_reached":
      return facts.cap === "enquiry_cap" ? facts.missedEnquiries30d : (facts.refusedAttempted ?? 0);
    case "churn_risk":
      return Math.round(facts.replyRate * 100);
  }
}

// ── Outcomes and states ──────────────────────────────────────────────────────

/**
 * The chips the log strip offers, in the order it draws them. B8: a fixed set
 * plus a free note, and the note is the seller's words, never parsed.
 *
 * Seven where the render drew six. `no_answer` is the states table's own row —
 * *called, no answer: unreachable, back in the queue with a cooling period* —
 * and a board that states the behaviour needs the button that produces it.
 */
export const CALL_OUTCOMES = [
  "interested",
  "call_back",
  "not_interested",
  "wrong_number",
  "closed_down",
  "claim_link_sent",
  "no_answer",
] as const;
export type CallOutcomeKey = (typeof CALL_OUTCOMES)[number];

export const OPEN_STATES = ["queued", "called", "callback", "unreachable"] as const;
export const CLOSED_STATES = ["won", "lost", "parked", "cleared"] as const;
export type OpenState = (typeof OPEN_STATES)[number];
export type ClosedState = (typeof CLOSED_STATES)[number];
export type TaskState = OpenState | ClosedState;

/** How long a no-answer waits before the row is due again. */
export const NO_ANSWER_COOLING_DAYS = 2;
/** How long an interested account or a sent claim link waits for a follow-up. */
export const FOLLOW_UP_DAYS = 2;
/** The furthest ahead a call-back may be booked. */
export const MAX_CALL_BACK_DAYS = 60;
/** How long a closed conversation keeps a business off the list. */
export const SUPPRESS_AFTER_CLOSE_DAYS = 90;

export type Transition =
  | { ok: true; state: OpenState; callBackAt: Date | null; coolingUntil: Date | null }
  | { ok: true; state: ClosedState; closeReason: CallOutcomeKey }
  | { ok: false; error: "call_back_needs_date" | "call_back_in_past" | "call_back_too_far" | "date_only_on_call_back" };

/** What logging an outcome does to the task. */
export function transition(outcome: CallOutcomeKey, now: Date, callBackAt: Date | null): Transition {
  if (outcome !== "call_back" && callBackAt) return { ok: false, error: "date_only_on_call_back" };
  switch (outcome) {
    case "call_back": {
      if (!callBackAt) return { ok: false, error: "call_back_needs_date" };
      if (callBackAt.getTime() <= now.getTime()) return { ok: false, error: "call_back_in_past" };
      if (callBackAt.getTime() > now.getTime() + MAX_CALL_BACK_DAYS * DAY_MS) return { ok: false, error: "call_back_too_far" };
      return { ok: true, state: "callback", callBackAt, coolingUntil: null };
    }
    case "no_answer":
      return { ok: true, state: "unreachable", callBackAt: null, coolingUntil: new Date(now.getTime() + NO_ANSWER_COOLING_DAYS * DAY_MS) };
    case "interested":
    case "claim_link_sent":
      return { ok: true, state: "called", callBackAt: null, coolingUntil: new Date(now.getTime() + FOLLOW_UP_DAYS * DAY_MS) };
    case "not_interested":
    case "closed_down":
      return { ok: true, state: "lost", closeReason: outcome };
    case "wrong_number":
      // Parks rather than loses: the conversation never happened, and the
      // number came from the licence import, which is where it is wrong.
      return { ok: true, state: "parked", closeReason: outcome };
  }
}

/** The end of the Dubai day an instant falls in. */
export function endOfDubaiDay(now: Date): Date {
  const local = new Date(now.getTime() + DUBAI_OFFSET_MS);
  const nextMidnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return new Date(nextMidnightLocal - DUBAI_OFFSET_MS);
}

/** Monday 00:00 in Dubai, for "this week". */
export function dubaiWeekStart(now: Date): Date {
  const local = new Date(now.getTime() + DUBAI_OFFSET_MS);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday);
  return new Date(mondayLocal - DUBAI_OFFSET_MS);
}

export interface DueFacts {
  state: TaskState;
  callBackAt: Date | null;
  coolingUntil: Date | null;
}

/**
 * Whether the row is a call to make today.
 *
 * A call-back is due on its day, not at its minute. A no-answer and a follow-up
 * are due when their wait ends. A closed task is never due.
 */
export function isDue(task: DueFacts, now: Date): boolean {
  switch (task.state) {
    case "queued":
      return true;
    case "callback":
      return task.callBackAt !== null && task.callBackAt.getTime() < endOfDubaiDay(now).getTime();
    case "unreachable":
    case "called":
      return task.coolingUntil === null || task.coolingUntil.getTime() <= now.getTime();
    default:
      return false;
  }
}

/** The row's action. A churn call is a save; a follow-up is not a first call. */
export function actionOf(signal: CrmSignalKey, state: TaskState): "call" | "save" | "follow_up" {
  if (signal === "churn_risk") return "save";
  if (state === "called") return "follow_up";
  return "call";
}

/**
 * What a business's earlier calls mean for a task created now.
 *
 * The call log predates the task table and outlives any one task, so a new
 * task starts where the last conversation left it rather than at `queued`: a
 * seller who asked to be rung on Thursday is not a cold call on Monday, and one
 * who said no last month is not on the list at all.
 */
export type Resume =
  | { kind: "suppress" }
  | { kind: "state"; state: OpenState; callBackAt: Date | null; coolingUntil: Date | null; lastTouchAt: Date; lastOutcome: string }
  | { kind: "fresh" };

export function resumeFrom(last: { kind: string; createdAt: Date; callBackAt: Date | null } | null, now: Date): Resume {
  if (!last) return { kind: "fresh" };
  const age = now.getTime() - last.createdAt.getTime();
  if (["not_interested", "wrong_number", "closed_down"].includes(last.kind)) {
    return age < SUPPRESS_AFTER_CLOSE_DAYS * DAY_MS ? { kind: "suppress" } : { kind: "fresh" };
  }
  const touch = { lastTouchAt: last.createdAt, lastOutcome: last.kind };
  if (last.kind === "call_back" && last.callBackAt && last.callBackAt.getTime() > now.getTime()) {
    return { kind: "state", state: "callback", callBackAt: last.callBackAt, coolingUntil: null, ...touch };
  }
  if (last.kind === "no_answer" && age < NO_ANSWER_COOLING_DAYS * DAY_MS) {
    return { kind: "state", state: "unreachable", callBackAt: null, coolingUntil: new Date(last.createdAt.getTime() + NO_ANSWER_COOLING_DAYS * DAY_MS), ...touch };
  }
  if ((last.kind === "interested" || last.kind === "claim_link_sent") && age < 30 * DAY_MS) {
    return { kind: "state", state: "called", callBackAt: null, coolingUntil: new Date(last.createdAt.getTime() + FOLLOW_UP_DAYS * DAY_MS), ...touch };
  }
  return { kind: "fresh" };
}

// ── The supply gate, as the banner states it ─────────────────────────────────

export interface SupplyGap {
  /** Listings the scope needs added before the listings condition passes. */
  listingsToAdd: number;
  /** Of those added, how many must arrive verified. */
  addedVerified: number;
  /** Unverified listings already here to verify. Asked for before new ones. */
  toVerify: number;
  /** Listings once the gap closes. */
  listingsAfter: number;
  /** Verified listings once the gap closes. */
  verifiedAfter: number;
  listingsPass: boolean;
  sharePass: boolean;
}

/**
 * What closes a held page's supply gate, and the figures after.
 *
 * Verifications of listings already in the scope come first, because those are
 * the calls this list can make — the listing is there, the number is on it, and
 * the ask is one upload. Listings the scope lacks come second, and only as many
 * of them need to be verified as the share still needs. Converting every
 * unverified listing takes the share to 100%, so when the listings condition
 * passes, verifications alone always clear it.
 *
 * On the handoff's own figures: 8 verified of 78, against a need of 60, is 16
 * verifications — 24 of 78, 30.8%. Against a need of 100 it is 22 listings
 * added and 22 of the 70 unverified verified, 30 of 100 — the board's 30 of
 * 100, reached by calls rather than by 22 new suppliers who each also have to
 * be verified. Integer arithmetic throughout; see `ceilShare`.
 */
export function supplyGap(facts: { listings: number; verified: number; need: number; minVerifiedShare: number; unverified: number }): SupplyGap {
  const listingsToAdd = Math.max(0, facts.need - facts.listings);
  const listingsAfter = facts.listings + listingsToAdd;
  const verifiedNeeded = Math.max(0, ceilShare(facts.minVerifiedShare, listingsAfter) - facts.verified);
  const toVerify = Math.min(facts.unverified, verifiedNeeded);
  const addedVerified = verifiedNeeded - toVerify;
  return {
    listingsToAdd,
    addedVerified,
    toVerify,
    listingsAfter,
    verifiedAfter: facts.verified + toVerify + addedVerified,
    listingsPass: listingsToAdd === 0,
    sharePass: facts.listings > 0 && facts.verified >= ceilShare(facts.minVerifiedShare, facts.listings),
  };
}

/** Whether a business counts as verified for the supply gate. */
export function isVerifiedTier(tier: number): boolean {
  return tier >= VERIFIED_TIER;
}
