import { filsToAed, parseAedToFils } from "./money";

/**
 * Board `3j-s` — a proposal, reduced to the rules a screenshot cannot show.
 *
 * Pure, with no database import, so the composer and the service read one set of
 * limits and the refusals are unit-tested without a request.
 *
 * ## What a proposal is
 *
 * The goods `3j` replies with priced lines against a parts list. An enquiry for
 * work has no parts list, so the reply is **one fee on a stated basis, a scope,
 * and an exclusions list** — plus the three commercial terms an engagement is
 * decided on: how long it runs, what it costs to start, and how long the offer
 * stands. No line, no quantity, no unit price (B2).
 *
 * ## What this module deliberately does not do
 *
 * **It does no arithmetic across terms.** `18,400 per month × 24 months + 6,000`
 * is a figure somebody will want, and it belongs to `1n-s`, whose handoff owes
 * the rules for it: mobilisation must appear in any normalised total (B6), and a
 * per-unit basis cannot be normalised against a scale string nobody parsed (B7).
 * A proposal records what the supplier stated. Anything added up from it is the
 * comparison's claim, labelled as such, on the comparison's board.
 */

/**
 * The default window, in days.
 *
 * Thirty rather than the goods composer's fourteen, because the render sets
 * thirty and an engagement is priced off a site visit and a scope rather than a
 * shelf price. `3j-s` Q4 wants a default per scope-sheet family instead; until a
 * family carries one, this is the single place to change it.
 */
export const PROPOSAL_DEFAULT_VALIDITY_DAYS = 30;

/** Ten years. A term beyond it is a typo for a number of days, not a contract. */
export const TERM_MONTHS_MAX = 120;

/** The same ceiling the scope sheet's own long fields take — `TEXT_MAX` on `Service`. */
export const PROPOSAL_TEXT_MAX = 4000;

/** Deliverable and delivered-where are a line each on the record and the PDF. */
export const PROPOSAL_LINE_MAX = 200;

/** `Decimal(12, 2)`: ten digits before the point. */
const FILS_CEILING = 10_000_000_000n * 100n;

export type ProposalField =
  | "service"
  | "fee"
  | "mobilisation"
  | "term"
  | "scope"
  | "deliverable"
  | "deliveredWhere"
  | "exclusions";

export type ProposalRefusal =
  | { field: "service"; code: "required" | "no_basis" | "stale_basis" }
  | { field: "fee"; code: "required" | "not_amount" | "zero" | "too_large" }
  | { field: "mobilisation"; code: "not_amount" | "too_large" }
  | { field: "term"; code: "not_months" }
  | { field: "scope"; code: "required" | "too_long" }
  | { field: "deliverable" | "deliveredWhere"; code: "too_long" }
  | { field: "exclusions"; code: "too_long" };

/** What the composer posts. Every value is as typed. */
export interface ProposalInput {
  serviceId: string | null;
  fee: string;
  mobilisation: string;
  termMonths: string;
  validityDays: number;
  /**
   * Board `7c-s`: how the buyer pays, from `PROPOSAL_PAYMENT_TERMS`; empty is
   * *not stated*. Stored on the quote rather than the proposal, where the goods
   * composer stores it, so `7c`'s *payment agreed* reads one column for both.
   */
  paymentTerms: string;
  scope: string;
  deliverable: string;
  deliveredWhere: string;
  exclusions: string;
}

/** What a send stores, once every value has been read. */
export interface ProposalClean {
  feeAed: string;
  mobilisationAed: string | null;
  termMonths: number | null;
  scope: string;
  deliverable: string | null;
  deliveredWhere: string | null;
  exclusions: string | null;
}

/**
 * An amount as a seller types one: `18,400`, `18400.50`, `AED 6,000`.
 *
 * Group separators and the currency are tolerated because the field is labelled
 * in dirhams and a seller pasting from their own spreadsheet will bring commas.
 * Anything else — a word, a third decimal, a range — is not an amount, and is
 * refused rather than read as one: `18-20k` stored as 18 is the platform writing
 * a price nobody offered.
 *
 * Returns fils, or null for an empty box, or `"invalid"`.
 */
export function readAmount(typed: string): bigint | null | "invalid" {
  const trimmed = typed.replace(/^\s*aed\s*/i, "").replace(/\s/g, "");
  if (trimmed === "") return null;
  /*
     A comma is a group separator only where the groups are whole. `18,4` is a
     seller halfway to `18,400`, not one hundred and eighty-four dirhams — read
     loosely, a draft saved mid-keystroke would come back with a fee of 184.
  */
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(trimmed)) return "invalid";
  return parseAedToFils(trimmed.replace(/,/g, ""));
}

/** Whole months, 1 to 120; `24 months` and `24` both read. Null for empty. */
export function readTermMonths(typed: string): number | null | "invalid" {
  const stripped = typed.trim().replace(/\s*months?$/i, "");
  if (stripped === "") return null;
  if (!/^\d{1,3}$/.test(stripped)) return "invalid";
  const months = Number(stripped);
  return months >= 1 && months <= TERM_MONTHS_MAX ? months : "invalid";
}

/**
 * Line endings unified and the ends trimmed. Nothing inside is rewritten: a
 * scope is the seller's own words and the buyer reads them as written.
 */
export function cleanText(typed: string): string {
  return typed.replace(/\r\n?/g, "\n").trim();
}

/**
 * Everything a send refuses, in field order, so the composer can mark each
 * field at once rather than one per attempt.
 *
 * The service and its basis are judged by the server, which has the scope
 * sheet; this reads only what the seller typed.
 */
export function checkProposal(
  input: ProposalInput,
): { ok: true; value: ProposalClean } | { ok: false; refusals: ProposalRefusal[] } {
  const refusals: ProposalRefusal[] = [];

  const fee = readAmount(input.fee);
  if (fee === null) refusals.push({ field: "fee", code: "required" });
  else if (fee === "invalid") refusals.push({ field: "fee", code: "not_amount" });
  // A proposal for nothing is not a proposal. A goods line may be zero — a
  // sample, an absorbed freight charge — because it sits beside other lines; a
  // proposal's fee is the whole of it.
  else if (fee === 0n) refusals.push({ field: "fee", code: "zero" });
  else if (fee >= FILS_CEILING) refusals.push({ field: "fee", code: "too_large" });

  const mobilisation = readAmount(input.mobilisation);
  if (mobilisation === "invalid") refusals.push({ field: "mobilisation", code: "not_amount" });
  else if (mobilisation !== null && mobilisation >= FILS_CEILING) {
    refusals.push({ field: "mobilisation", code: "too_large" });
  }

  const term = readTermMonths(input.termMonths);
  if (term === "invalid") refusals.push({ field: "term", code: "not_months" });

  const scope = cleanText(input.scope);
  if (scope === "") refusals.push({ field: "scope", code: "required" });
  else if (scope.length > PROPOSAL_TEXT_MAX) refusals.push({ field: "scope", code: "too_long" });

  const deliverable = cleanText(input.deliverable);
  if (deliverable.length > PROPOSAL_LINE_MAX) refusals.push({ field: "deliverable", code: "too_long" });
  const deliveredWhere = cleanText(input.deliveredWhere);
  if (deliveredWhere.length > PROPOSAL_LINE_MAX) refusals.push({ field: "deliveredWhere", code: "too_long" });
  const exclusions = cleanText(input.exclusions);
  if (exclusions.length > PROPOSAL_TEXT_MAX) refusals.push({ field: "exclusions", code: "too_long" });

  if (refusals.length > 0) return { ok: false, refusals };

  return {
    ok: true,
    value: {
      feeAed: filsToAed(fee as bigint),
      mobilisationAed: mobilisation === null ? null : filsToAed(mobilisation as bigint),
      termMonths: term as number | null,
      scope,
      deliverable: deliverable || null,
      deliveredWhere: deliveredWhere || null,
      exclusions: exclusions || null,
    },
  };
}

/**
 * What a draft keeps of the same input: everything readable, nothing refused.
 *
 * Autosave runs while somebody is typing — `18,4` on its way to `18,400` — so a
 * value that does not read yet is kept as *not stated* rather than refused, and
 * over-long text is cut to the ceiling rather than lost. The send is where the
 * refusals live, because that is where a buyer is about to read it.
 */
export function draftProposal(input: ProposalInput): Omit<ProposalClean, "feeAed"> & { feeAed: string | null } {
  const fee = readAmount(input.fee);
  const mobilisation = readAmount(input.mobilisation);
  const term = readTermMonths(input.termMonths);
  const within = (text: string, max: number) => cleanText(text).slice(0, max);
  const fits = (fils: bigint | null | "invalid") =>
    typeof fils === "bigint" && fils < FILS_CEILING ? filsToAed(fils) : null;

  return {
    feeAed: fits(fee),
    mobilisationAed: fits(mobilisation),
    termMonths: typeof term === "number" ? term : null,
    scope: within(input.scope, PROPOSAL_TEXT_MAX),
    deliverable: within(input.deliverable, PROPOSAL_LINE_MAX) || null,
    deliveredWhere: within(input.deliveredWhere, PROPOSAL_LINE_MAX) || null,
    exclusions: within(input.exclusions, PROPOSAL_TEXT_MAX) || null,
  };
}

/* ── What the readers downstream need ─────────────────────────────────────── */

/**
 * The part of a sent proposal that stands where a quote's total would.
 *
 * Every reader that used to print `totalAed` for a quote reads this instead when
 * the quote is a proposal: a sum of no lines is `0.00`, and `0.00` on a pipeline
 * row, a compare column or an accepted record is the platform inventing a price.
 */
export interface ProposalFigure {
  feeAed: string;
  /** The key, for comparing two revisions; the label is what anybody reads. */
  feeBasis: string;
  feeBasisLabel: string;
  mobilisationAed: string | null;
  termMonths: number | null;
}

/** The columns a reader selects for it — one select, so no reader drops one. */
export const PROPOSAL_FIGURE_SELECT = {
  feeAed: true,
  feeBasis: true,
  feeBasisLabel: true,
  mobilisationAed: true,
  termMonths: true,
} as const;

export function toProposalFigure(
  row: {
    feeAed: { toString(): string } | null;
    feeBasis: string | null;
    feeBasisLabel: string | null;
    mobilisationAed: { toString(): string } | null;
    termMonths: number | null;
  } | null | undefined,
): ProposalFigure | null {
  // A draft is never read by these readers; a row without a fee or a basis is
  // one, and is not a figure anybody was sent.
  if (!row || row.feeAed === null || row.feeBasis === null || row.feeBasisLabel === null) return null;
  return {
    feeAed: row.feeAed.toString(),
    feeBasis: row.feeBasis,
    feeBasisLabel: row.feeBasisLabel,
    mobilisationAed: row.mobilisationAed?.toString() ?? null,
    termMonths: row.termMonths,
  };
}

/** A proposal's full record — what the accepted record and the admin evidence render. */
export interface ProposalRecord extends ProposalFigure {
  serviceName: string;
  scope: string;
  /** The sheet's turnaround at send — board `1n-s`. Null is *Not stated*. */
  turnaround: string | null;
  deliverable: string | null;
  deliveredWhere: string | null;
  exclusions: string | null;
}

export const PROPOSAL_RECORD_SELECT = {
  ...PROPOSAL_FIGURE_SELECT,
  serviceName: true,
  scope: true,
  turnaround: true,
  deliverable: true,
  deliveredWhere: true,
  exclusions: true,
} as const;

export function toProposalRecord(
  row:
    | (Parameters<typeof toProposalFigure>[0] & {
        serviceName: string;
        scope: string;
        turnaround: string | null;
        deliverable: string | null;
        deliveredWhere: string | null;
        exclusions: string | null;
      })
    | null
    | undefined,
): ProposalRecord | null {
  const figure = toProposalFigure(row);
  if (!figure || !row) return null;
  return {
    ...figure,
    serviceName: row.serviceName,
    scope: row.scope,
    turnaround: row.turnaround,
    deliverable: row.deliverable,
    deliveredWhere: row.deliveredWhere,
    exclusions: row.exclusions,
  };
}

/**
 * Whether two revisions' fees can be set against each other.
 *
 * Only on the same basis. `18,400 per month` then `210,000 fixed fee` is not a
 * change of 191,600; it is a different proposal, and a thread line reading
 * *up 1,041%* would be arithmetic across two units.
 */
export function comparableFees(a: ProposalFigure, b: ProposalFigure): boolean {
  return a.feeBasis === b.feeBasis;
}
