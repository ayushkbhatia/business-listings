/**
 * Board 10e — what an enquiry's row says, and where it is counted.
 *
 * Pure, and the only place either is decided. The inbox renders from it, the
 * chips count from it, `NEEDS YOU` picks from it and the tests read it — so the
 * verb on a row, the chip that row is counted under and the card that names it
 * cannot disagree.
 *
 * ## The action is the status (`B2`)
 *
 * Nothing here is stored. `Enquiry` has no status column and gets none: the
 * verb is derived from how many suppliers were sent to, how many quoted, and the
 * clock. A stored label drifts the moment a quote lands; this cannot.
 *
 * ## Every row is in exactly one chip (`B1`)
 *
 * The board shipped a chip set that summed to the right total with a row in the
 * wrong bucket — an expired enquiry folded into *Quotes in*, inflating the one
 * bucket a buyer opens to find work they can still do. `bucketOf` is total over
 * every row and returns one bucket; `countBuckets` counts the same rows the table
 * shows. The check is per row, not per total.
 */

import { MIN_TO_COMPARE } from "./tracking";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Close to closing. Quotes in with this long or less to go is *compare now*
 * rather than *2 of 4 in*: waiting for the rest stops being worth what it costs.
 */
export const COMPARE_WINDOW_MS = 3 * DAY;
/** Under a day to close is urgent; the closes column turns red. */
export const URGENT_MS = DAY;

export type InboxBucket = "awaiting" | "quotes_in" | "accepted" | "expired";
export const INBOX_BUCKETS: readonly InboxBucket[] = ["awaiting", "quotes_in", "accepted", "expired"];

export interface InboxFacts {
  createdAt: Date;
  closesAt: Date;
  /** Suppliers it went to. */
  sentTo: number;
  /** Suppliers with a quote or proposal sent — not quote rows; three revisions is one supplier. */
  quoted: number;
  /** Whether the buyer has opened any quote on it. */
  anyQuoteRead: boolean;
  accepted: boolean;
  /** Suppliers who have not replied and may still be nudged — board 1i's rule, per seller. */
  nudgeable: number;
  /** Suppliers who have not replied and have not declined. */
  unanswered: number;
  /** Every supplier declined and none quoted. */
  allDeclined: boolean;
  /** Set when this expired enquiry has already been re-sent. */
  resentAsRef: string | null;
}

export type InboxVerb =
  | { kind: "accepted" }
  | { kind: "compare"; quoted: number }
  | { kind: "view" }
  | { kind: "partial"; quoted: number; sentTo: number }
  | { kind: "nudge"; sellers: number }
  | { kind: "awaiting" }
  | { kind: "declined" }
  | { kind: "resend" }
  | { kind: "resent"; ref: string };

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

export function isClosed(facts: Pick<InboxFacts, "closesAt">, now: Date): boolean {
  return now.getTime() >= facts.closesAt.getTime();
}

/**
 * The one bucket a row is counted in. Accepted wins over everything, including
 * the clock — an accepted enquiry that has since passed its close is still the
 * record of an agreement, not an expiry.
 */
export function bucketOf(facts: InboxFacts, now: Date): InboxBucket {
  if (facts.accepted) return "accepted";
  if (isClosed(facts, now)) return "expired";
  return facts.quoted > 0 ? "quotes_in" : "awaiting";
}

export function verbOf(facts: InboxFacts, now: Date): InboxVerb {
  const bucket = bucketOf(facts, now);
  switch (bucket) {
    case "accepted":
      return { kind: "accepted" };
    case "expired":
      // B3: terminal, one action. Once re-sent, the row points at the new one.
      return facts.resentAsRef ? { kind: "resent", ref: facts.resentAsRef } : { kind: "resend" };
    case "awaiting":
      if (facts.allDeclined) return { kind: "declined" };
      return facts.nudgeable > 0 ? { kind: "nudge", sellers: facts.nudgeable } : { kind: "awaiting" };
    case "quotes_in": {
      const allIn = facts.quoted >= facts.sentTo;
      if (facts.quoted < MIN_TO_COMPARE) {
        // Comparing one quote is not comparing. Everything in, one quote: read it.
        return allIn ? { kind: "view" } : { kind: "partial", quoted: facts.quoted, sentTo: facts.sentTo };
      }
      const closing = facts.closesAt.getTime() - now.getTime() <= COMPARE_WINDOW_MS;
      return allIn || closing
        ? { kind: "compare", quoted: facts.quoted }
        : { kind: "partial", quoted: facts.quoted, sentTo: facts.sentTo };
    }
  }
}

export function toneOf(verb: InboxVerb): Tone {
  switch (verb.kind) {
    case "accepted":
    case "compare":
    case "view":
      return "ok";
    case "partial":
      return "info";
    case "nudge":
    case "declined":
      return "warn";
    case "awaiting":
    case "resend":
    case "resent":
      return "neutral";
  }
}

/** The closes column: its state, and its tone — red under a day, amber inside the compare window. */
export type ClosesCell =
  | { kind: "closed" }
  | { kind: "expired" }
  | { kind: "open"; msLeft: number; tone: Tone };

export function closesOf(facts: InboxFacts, now: Date): ClosesCell {
  if (facts.accepted) return { kind: "closed" };
  if (isClosed(facts, now)) return { kind: "expired" };
  const msLeft = facts.closesAt.getTime() - now.getTime();
  const tone: Tone = msLeft < URGENT_MS ? "bad" : msLeft <= COMPARE_WINDOW_MS ? "warn" : "neutral";
  return { kind: "open", msLeft, tone };
}

/**
 * What an expired row's second line says about why it died — the platform's own
 * failure, said plainly rather than hidden.
 */
export type ExpiryNote = "not_actioned" | "no_quotes" | "lapsed";

export function expiryNoteOf(facts: InboxFacts): ExpiryNote {
  if (facts.quoted === 0) return "no_quotes";
  return facts.anyQuoteRead ? "lapsed" : "not_actioned";
}

export function countBuckets<T extends InboxFacts>(rows: readonly T[], now: Date): Record<InboxBucket, number> & { all: number } {
  const counts = { all: rows.length, awaiting: 0, quotes_in: 0, accepted: 0, expired: 0 };
  for (const row of rows) counts[bucketOf(row, now)] += 1;
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// NEEDS YOU (B4)
// ─────────────────────────────────────────────────────────────────────────────

export type NeedsYou<T> =
  | { kind: "compare"; row: T; quoted: number; msLeft: number }
  | { kind: "nudge"; row: T; sellers: number; msLeft: number };

/**
 * Two cards at most, picked from the table by what doing nothing costs.
 *
 * First, the open enquiry with quotes in that closes soonest. Second, the open
 * enquiry with nothing back and sellers still nudgeable that closes soonest.
 * When there is no second, the next enquiry with quotes in takes its place —
 * board 10e's *all quoted, none compared* state. It picks; it never summarises.
 */
export function needsYou<T extends InboxFacts>(rows: readonly T[], now: Date): NeedsYou<T>[] {
  const open = rows
    .filter((row) => !row.accepted && !isClosed(row, now))
    .sort((a, b) => a.closesAt.getTime() - b.closesAt.getTime());

  const withQuotes = open.filter((row) => row.quoted > 0);
  const nudgeable = open.filter((row) => row.quoted === 0 && !row.allDeclined && row.nudgeable > 0);

  const left = (row: T) => row.closesAt.getTime() - now.getTime();
  const compareCard = (row: T): NeedsYou<T> => ({ kind: "compare", row, quoted: row.quoted, msLeft: left(row) });

  const cards: NeedsYou<T>[] = [];
  if (withQuotes[0]) cards.push(compareCard(withQuotes[0]));
  if (nudgeable[0]) cards.push({ kind: "nudge", row: nudgeable[0], sellers: nudgeable[0].nudgeable, msLeft: left(nudgeable[0]) });
  else if (withQuotes[1]) cards.push(compareCard(withQuotes[1]));
  return cards.slice(0, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Your enquiry history (B8, B9)
// ─────────────────────────────────────────────────────────────────────────────

export interface HistoryFacts {
  createdAt: Date;
  /** When the first quote or proposal on it was sent, or null when none was. */
  firstQuoteAt: Date | null;
  /** The supplier whose quote was accepted, or null. */
  acceptedBusinessId: string | null;
}

export interface EnquiryHistory {
  sent: number;
  /** Over answered enquiries only (B8), or null when none was answered. */
  medianFirstQuoteMs: number | null;
  /** How many enquiries the median is over, so the card can say. */
  answered: number;
  accepted: number;
  /** Suppliers accepted on two or more of these enquiries. */
  repeatSuppliers: number;
}

/**
 * The buyer's own numbers over one window — the calendar year, as the card says.
 *
 * `B8`: the median first quote is over answered enquiries only. Counting an
 * unanswered one as infinite or as zero both produce a number that means
 * nothing, so an unanswered enquiry is simply not in it — and the card states
 * how many it is over.
 */
export function historyOf(rows: readonly HistoryFacts[], since: Date): EnquiryHistory {
  const inWindow = rows.filter((row) => row.createdAt.getTime() >= since.getTime());
  const latencies = inWindow
    .filter((row): row is HistoryFacts & { firstQuoteAt: Date } => row.firstQuoteAt !== null)
    .map((row) => Math.max(0, row.firstQuoteAt.getTime() - row.createdAt.getTime()))
    .sort((a, b) => a - b);

  const acceptedBy = new Map<string, number>();
  for (const row of inWindow) {
    if (row.acceptedBusinessId) acceptedBy.set(row.acceptedBusinessId, (acceptedBy.get(row.acceptedBusinessId) ?? 0) + 1);
  }

  return {
    sent: inWindow.length,
    medianFirstQuoteMs: median(latencies),
    answered: latencies.length,
    accepted: [...acceptedBy.values()].reduce((sum, n) => sum + n, 0),
    repeatSuppliers: [...acceptedBy.values()].filter((n) => n >= 2).length,
  };
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** 1 January, 00:00 in Dubai, of the year `now` falls in there. */
export function dubaiYearStart(now: Date): Date {
  const year = Number(new Intl.DateTimeFormat("en-AE", { timeZone: "Asia/Dubai", year: "numeric" }).format(now));
  // Dubai is UTC+4 with no daylight saving.
  return new Date(Date.UTC(year, 0, 1, -4, 0, 0));
}

/** One row of the inbox: the facts, and everything the page derives from them. */
export interface InboxRow extends InboxFacts {
  id: string;
  ref: string;
  requirement: string;
  lineCount: number;
  /** The place, as the buyer named it. */
  place: string | null;
  isBrief: boolean;
  bucket: InboxBucket;
  verb: InboxVerb;
  tone: Tone;
  closes: ClosesCell;
  expiryNote: ExpiryNote | null;
}

export type InboxRowMeta = Pick<InboxRow, "id" | "ref" | "requirement" | "lineCount" | "place" | "isBrief">;

/**
 * Derive a row. The one place bucket, verb, tone, close and expiry note are
 * computed together, so the inbox read and the gallery's fixtures cannot word
 * the same facts two ways.
 */
export function inboxRow(meta: InboxRowMeta, facts: InboxFacts, now: Date): InboxRow {
  const bucket = bucketOf(facts, now);
  const verb = verbOf(facts, now);
  return {
    ...facts,
    ...meta,
    bucket,
    verb,
    tone: toneOf(verb),
    closes: closesOf(facts, now),
    expiryNote: bucket === "expired" ? expiryNoteOf(facts) : null,
  };
}

/**
 * The first sentence, or line, of what the buyer asked for. Never a paraphrase.
 *
 * The inbox's row title since board 10e, and board 10f's name for the job being
 * reviewed — one function, so an enquiry is called the same thing on both.
 */
export function requirementHeadline(requirement: string): string {
  const first = requirement.split(/\n|(?<=[.?!])\s/)[0]?.trim() ?? requirement;
  return first.replace(/[.]$/, "") || requirement;
}
