import { dubaiDayStart } from "@/lib/format/date";
import { parseAedToFils } from "@/lib/quote/money";
import type { Prisma } from "@/lib/db/generated/client";

/**
 * Board `7c-s` — the accepted proposal as an engagement that runs, reduced to
 * the date rules a screenshot cannot show.
 *
 * Pure, and shared by the record page, its PDF, the review gate and the seller's
 * review board, so the four cannot disagree about when a term ends or when a
 * review opens.
 *
 * ## What this module will not do
 *
 * **It adds up nothing.** No total, no contract value, no *24 × 18,400*. What
 * was agreed is a fee on a basis, a term and a one-off; a sum of them is the
 * comparison's labelled arithmetic (`1n-s`), and printing it on the record in
 * the voice of the agreed terms is the one thing the board rules out (`B3`,
 * Q1 is the owner's).
 *
 * **It observes nothing.** The phase of a term is read off the calendar, not off
 * the work: *the term started on 1 Nov* is a date, *the first visit happened* is
 * a claim the platform cannot make (`B9`). There is no progress and no
 * completion here to compute.
 *
 * ## Calendar dates, not instants
 *
 * A brief's start is a `date` column, read back as UTC midnight. Every date this
 * returns is the same kind of value, and *today* is the calendar day in Dubai
 * (`dubaiDayStart`), so a term does not end a day early for a buyer reading the
 * page at 1am.
 */

const DAY_MS = 86_400_000;

/** The window in which the page says a term is near its end. §States: *within 90 days*. */
export const TERM_ENDING_DAYS = 90;

/** What the date rules read — a subset of the accepted record. */
export interface ContractFacts {
  /** The instant the buyer accepted. Null only on rows older than either stamp. */
  acceptedAt: Date | null;
  proposal: { termMonths: number | null } | null;
  brief: {
    engagementType: string;
    cadence: string | null;
    startMode: string;
    startsOn: Date | null;
  } | null;
}

export interface TermDates {
  /** The first day of the term — the brief's start date. */
  start: Date;
  /** The last day of the term, inclusive. */
  end: Date;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The same calendar day `months` later — or, where that month is too short to
 * have it, the first day of the month after. 31 Jan + 1 month is 1 Mar, so a
 * one-month term from 31 Jan ends on 28 Feb rather than on 2 Mar, which is what
 * `Date.UTC`'s overflow would say.
 */
export function anniversary(start: Date, months: number): Date {
  const total = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = start.getUTCDate();
  return day <= daysInMonth(year, month)
    ? new Date(Date.UTC(year, month, day))
    : new Date(Date.UTC(year, month + 1, 1));
}

/**
 * `B4`: the term's first and last day, from the brief's start date and the
 * proposal's term. 1 Nov 2026 for 24 months is 1 Nov 2026 to 31 Oct 2028.
 *
 * Null when either half is missing: a brief that asked for *as soon as
 * possible* has no start date anybody wrote down, and a term with no months is
 * not a term. The page says which is missing rather than inventing the other —
 * an acceptance date is not a start date.
 */
export function termDates(facts: Pick<ContractFacts, "proposal" | "brief">): TermDates | null {
  const months = facts.proposal?.termMonths ?? null;
  const start = facts.brief?.startMode === "from_date" ? (facts.brief.startsOn ?? null) : null;
  if (months === null || start === null) return null;
  return { start, end: new Date(anniversary(start, months).getTime() - DAY_MS) };
}

/**
 * Whether this is an engagement that runs rather than a job that is done.
 *
 * The brief says so when there is one. A proposal that stated a term says so
 * without one — a service line enquiry has no brief, and *24 months* is not a
 * one-off whatever the enquiry was shaped like.
 */
export function isOngoing(facts: Pick<ContractFacts, "proposal" | "brief">): boolean {
  if (!facts.proposal) return false;
  return facts.brief?.engagementType === "ongoing_contract" || facts.proposal.termMonths !== null;
}

export type ContractPhase =
  /** No term, or no start date to count it from. */
  | { kind: "undated" }
  | { kind: "not_started"; start: Date; end: Date; daysToStart: number }
  | { kind: "running"; start: Date; end: Date }
  /** Inside `TERM_ENDING_DAYS` of the last day. `daysLeft` counts the last day itself. */
  | { kind: "ending"; start: Date; end: Date; daysLeft: number }
  | { kind: "ended"; start: Date; end: Date };

/** Where the calendar is against the term. Read off dates only — see the module note. */
export function contractPhase(facts: Pick<ContractFacts, "proposal" | "brief">, now: Date): ContractPhase {
  const dates = termDates(facts);
  if (!dates) return { kind: "undated" };
  const today = dubaiDayStart(now).getTime();
  const { start, end } = dates;
  if (today < start.getTime()) {
    return { kind: "not_started", start, end, daysToStart: Math.round((start.getTime() - today) / DAY_MS) };
  }
  if (today > end.getTime()) return { kind: "ended", start, end };
  const daysLeft = Math.round((end.getTime() - today) / DAY_MS) + 1;
  return daysLeft <= TERM_ENDING_DAYS ? { kind: "ending", start, end, daysLeft } : { kind: "running", start, end };
}

/**
 * How long the first delivery cycle is, for the review prompt (`B10`).
 *
 * A month for a monthly engagement; a quarter otherwise. An annual cadence is
 * capped at a quarter rather than made to wait a year: a review of how a firm
 * mobilised, attended and reported is fair after three months even where the
 * main visit is once a year, and a buyer told to come back in twelve months does
 * not.
 */
export function firstCycle(cadence: string | null): { months: number; unit: "month" | "quarter" } {
  return cadence === "monthly" ? { months: 1, unit: "month" } : { months: 3, unit: "quarter" };
}

/**
 * The calendar day a review of this acceptance opens (`B10`).
 *
 * *There is nothing to review on day one.* So:
 *
 * - **A goods quote** — at acceptance, as `7c` always had it. The parts arrive or
 *   they do not.
 * - **An ongoing engagement** — one delivery cycle after the work starts: the
 *   brief's start date, or acceptance where the start was *as soon as possible*
 *   or already past.
 * - **A one-off job or a call-off** — on the start date, or at acceptance.
 *
 * Null when there is no acceptance date to count from, which the gate reads as
 * *open* — rows that old predate every rule here.
 */
export function reviewOpensOn(facts: ContractFacts): Date | null {
  if (!facts.acceptedAt) return null;
  const accepted = dubaiDayStart(facts.acceptedAt);
  if (!facts.proposal) return accepted;

  const briefStart = facts.brief?.startMode === "from_date" ? (facts.brief.startsOn ?? null) : null;
  const start = briefStart && briefStart.getTime() > accepted.getTime() ? briefStart : accepted;
  if (!isOngoing(facts)) return start;
  return anniversary(start, firstCycle(facts.brief?.cadence ?? null).months);
}

/** Whether a review may be written today. */
export function reviewOpen(facts: ContractFacts, now: Date): boolean {
  const opens = reviewOpensOn(facts);
  return opens === null || dubaiDayStart(now).getTime() >= opens.getTime();
}

/* ── What the supplier committed to, from the proposal (`B6`) ─────────────── */

/** Where a commitment's words came from, which the rail prints beside it. */
export type CommitmentSource = "brief" | "scope_sheet" | "deliverable" | "proposal";

export type ProposalCommitment =
  | { kind: "start"; on: Date; source: "brief" }
  | { kind: "mobilisation"; aed: string; source: "proposal" }
  | { kind: "cadence"; cadence: string; source: "brief" }
  | { kind: "turnaround"; text: string; source: "scope_sheet" }
  | { kind: "deliverable"; text: string; source: "deliverable" }
  | { kind: "delivered_where"; text: string; source: "proposal" };

/**
 * `B6`: commitments are the proposal's own fields, each with its source — not
 * sentences lifted from the thread, as `7c` has to do for a goods quote.
 *
 * Only what was stated. An unstated turnaround is not a commitment of *Not
 * stated*; it is simply not on this list, and the scope card shows the gap.
 * There is no *named account engineer* here: no proposal field holds one, and a
 * name read out of the scope's prose would be the thread extraction this board
 * replaces.
 */
export function proposalCommitments(input: {
  proposal: {
    mobilisationAed: string | null;
    turnaround: string | null;
    deliverable: string | null;
    deliveredWhere: string | null;
  };
  brief: ContractFacts["brief"];
}): ProposalCommitment[] {
  const out: ProposalCommitment[] = [];
  const { proposal, brief } = input;
  if (brief?.startMode === "from_date" && brief.startsOn) {
    out.push({ kind: "start", on: brief.startsOn, source: "brief" });
  }
  // A stated nil is *no mobilisation charge* — a term, not something to deliver.
  if (proposal.mobilisationAed !== null && parseAedToFils(proposal.mobilisationAed) > 0n) {
    out.push({ kind: "mobilisation", aed: proposal.mobilisationAed, source: "proposal" });
  }
  if (brief?.engagementType === "ongoing_contract" && brief.cadence) {
    out.push({ kind: "cadence", cadence: brief.cadence, source: "brief" });
  }
  if (proposal.turnaround) out.push({ kind: "turnaround", text: proposal.turnaround, source: "scope_sheet" });
  if (proposal.deliverable) out.push({ kind: "deliverable", text: proposal.deliverable, source: "deliverable" });
  if (proposal.deliveredWhere) {
    out.push({ kind: "delivered_where", text: proposal.deliveredWhere, source: "proposal" });
  }
  return out;
}

/* ── Reading the facts ─────────────────────────────────────────────────────── */

/**
 * The enquiry columns the date rules read, as one select, so the record page,
 * the review gate and the seller's review board cannot each read a different
 * subset and disagree about the day a review opens.
 */
export const CONTRACT_FACTS_SELECT = {
  contactReleasedAt: true,
  contactReleasedToBusinessId: true,
  serviceBrief: { select: { engagementType: true, cadence: true, startMode: true, startsOn: true } },
  quotes: {
    where: { status: "accepted" },
    orderBy: [{ acceptedAt: "desc" }, { revision: "desc" }, { id: "asc" }],
    select: { businessId: true, acceptedAt: true, proposal: { select: { termMonths: true, feeAed: true } } },
  },
} satisfies Prisma.EnquirySelect;

export function toContractFacts(row: {
  contactReleasedAt: Date | null;
  contactReleasedToBusinessId: string | null;
  serviceBrief: { engagementType: string; cadence: string | null; startMode: string; startsOn: Date | null } | null;
  quotes: { businessId: string; acceptedAt: Date | null; proposal: { termMonths: number | null; feeAed: unknown } | null }[];
}): ContractFacts {
  const accepted = row.quotes.find((quote) => quote.businessId === row.contactReleasedToBusinessId) ?? null;
  return {
    acceptedAt: accepted?.acceptedAt ?? row.contactReleasedAt,
    // A draft-shaped proposal row with no fee was never sent, and is no proposal.
    proposal: accepted?.proposal && accepted.proposal.feeAed !== null ? { termMonths: accepted.proposal.termMonths } : null,
    brief: row.serviceBrief,
  };
}
