import type { RecipientState } from "@/lib/db/generated/enums";

/**
 * Board 1i's tracking page, reduced to the decisions a screenshot cannot show.
 *
 * The spec names the defect this page is most likely to ship with: "the badge,
 * the h1 and the row states must always agree. Three counts live on this page —
 * sent, quoted, and lines quoted per recipient — and a header that lags the
 * rows is the defect this page is most likely to ship with."
 *
 * So the header is derived from the rows rather than counted alongside them.
 * There is no second count to drift.
 */

export interface TrackedRecipient {
  businessId: string;
  slug: string;
  displayName: string;
  state: RecipientState;
  openedAt: Date | null;
  buyerNudgedAt: Date | null;
  deliveredAt: Date;
  /** Null unless they have quoted. */
  quotedAt: Date | null;
  /** Lines they priced, and the enquiry's own line count. */
  quotedLines: number;
  totalLines: number;
  /** The seller's own words, when they gave a reason for declining. */
  declineReason: string | null;
  /** True when the buyer revised the requirement after this quote was sent. */
  superseded: boolean;
  quotedAgainstRevision: number;
}

/**
 * The order the rows are read in.
 *
 * Quoted first, then opened, then delivered, then declined — a buyer scanning
 * this page wants the replies at the top, not chronology. `no_response` sorts
 * with declined: both are endings.
 */
const RANK: Record<RecipientState, number> = {
  quoted: 0,
  opened: 1,
  delivered: 2,
  declined: 3,
  no_response: 4,
};

export function sortRecipients(rows: readonly TrackedRecipient[]): TrackedRecipient[] {
  return [...rows].sort((a, b) => {
    if (RANK[a.state] !== RANK[b.state]) return RANK[a.state] - RANK[b.state];
    /*
       Within quoted, fastest first. The latency is the thing a buyer is
       weighing when two suppliers both replied, and it is the same figure the
       row prints.
    */
    if (a.state === "quoted" && b.state === "quoted") {
      return latencyMs(a) - latencyMs(b);
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * `quotedAt − deliveredAt`. Computed, never stored as an editable figure.
 *
 * Floored at zero. A quote cannot precede its own delivery, but the data can
 * say it did — a backfill, a clock skew between two writers, or a fixture
 * built in the wrong order — and `formatDuration` throws on a negative. That
 * turned one odd row into a 500 for the whole tracking page, which is the last
 * page that should break: a buyer opens it to find out whether anybody replied.
 *
 * Zero reads as "immediately", which is the honest rendering of a figure that
 * cannot be trusted to be anything else.
 */
export function latencyMs(row: TrackedRecipient): number {
  if (!row.quotedAt) return Number.POSITIVE_INFINITY;
  return Math.max(0, row.quotedAt.getTime() - row.deliveredAt.getTime());
}

/**
 * What the row says it is, once the window and the clock are taken into account.
 *
 * `no_response` never appears before `closesAt`. The spec is explicit and the
 * reason is fairness: "labelling a supplier as unresponsive while the window is
 * open is unfair and wrong". A supplier with twelve hours left has not failed to
 * respond; they have not responded *yet*, which is `delivered`.
 */
export function effectiveState(
  row: TrackedRecipient,
  closesAt: Date,
  now: Date,
): RecipientState {
  const closed = now.getTime() >= closesAt.getTime();
  if (!closed && row.state === "no_response") return row.openedAt ? "opened" : "delivered";
  if (closed && (row.state === "delivered" || row.state === "opened")) return "no_response";
  return row.state;
}

export interface HeaderState {
  /** How many have quoted. Drives the badge, the h1 and nothing else. */
  quoted: number;
  sent: number;
  /** `sent` before any reply, `quoted` from the first quote onward. */
  mode: "sent" | "quoted" | "accepted" | "all_declined";
}

/**
 * The header, read off the rows.
 *
 * It tracks the most useful fact rather than the original one: before any reply
 * it is the number sent, and from the first quote onward it is the number
 * quoted. Two other modes take precedence because they change what the page is
 * for — an accepted enquiry is a record, and an all-declined one is a problem
 * to solve rather than a wait to sit through.
 */
export function headerState(
  rows: readonly TrackedRecipient[],
  options: { accepted: boolean; closesAt: Date; now: Date },
): HeaderState {
  const states = rows.map((row) => effectiveState(row, options.closesAt, options.now));
  const quoted = states.filter((s) => s === "quoted").length;
  const sent = rows.length;

  if (options.accepted) return { quoted, sent, mode: "accepted" };
  /*
     All declined is only "all declined" when nobody quoted. A single quote
     alongside four declines is a page with something on it, and framing that as
     a failure would bury the one reply the buyer is waiting for.
  */
  if (sent > 0 && quoted === 0 && states.every((s) => s === "declined")) {
    return { quoted, sent, mode: "all_declined" };
  }
  return { quoted, sent, mode: quoted > 0 ? "quoted" : "sent" };
}

/** Board 1i: one nudge per recipient, ever, and not before 24 hours. */
export const NUDGE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Whether this row may be nudged.
 *
 * The 24-hour floor is deliberate: "a nudge sent an hour after delivery reads as
 * impatience, and the median first reply is under two hours anyway". Only from
 * `delivered` — a supplier who has opened the enquiry is already reading it, and
 * one who declined has answered.
 */
export function canNudge(row: TrackedRecipient, now: Date): boolean {
  if (row.state !== "delivered") return false;
  if (row.buyerNudgedAt) return false;
  return now.getTime() - row.deliveredAt.getTime() >= NUDGE_AFTER_MS;
}

/** Board 1h's cap, applying here too: a fan-out never exceeds eight. */
export const MAX_RECIPIENTS = 8;

/**
 * Whether the "add two more suppliers" control renders at all.
 *
 * Absent at the cap, not disabled. The spec says so, and a disabled control
 * invites the buyer to work out what they are missing when the answer is
 * nothing they can change.
 */
export function canAddRecipients(sent: number): boolean {
  return sent < MAX_RECIPIENTS;
}

/** Comparing one quote is not comparing. */
export const MIN_TO_COMPARE = 2;

export function compareBlockedBy(
  quoted: number,
  labels: { none: string; one: string },
): string | null {
  if (quoted === 0) return labels.none;
  if (quoted < MIN_TO_COMPARE) return labels.one;
  return null;
}
