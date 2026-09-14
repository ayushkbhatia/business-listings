import { EMIRATES } from "@/lib/uae";
import { formatCount, formatDate } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { feeAmount, mobilisationWords, paymentTermsWords, termWords, typedAmount } from "@/lib/quote/proposal-words";
import {
  contractPhase,
  firstCycle,
  isOngoing,
  proposalCommitments,
  reviewOpen,
  reviewOpensOn,
  termDates,
  type ContractPhase,
  type ProposalCommitment,
} from "./accepted-proposal";
import type { AcceptedRecord } from "./accepted-record";
import { acceptedWindow, REVIEW_WINDOW_DAYS, windowOpen } from "@/lib/reviews/eligibility";

/**
 * Board `7c-s` — the accepted proposal, in words.
 *
 * The page and the PDF both print from here (acceptance criterion 10: *the PDF
 * and the page carry identical fields*), so a term cannot read *1 Nov 2026 to
 * 31 Oct 2028* in one and *24 months* in the other. The rules are in
 * `accepted-proposal.ts`; this only says them.
 */

export type ProposalRecordValue = AcceptedRecord & {
  quote: AcceptedRecord["quote"] & { proposal: NonNullable<AcceptedRecord["quote"]["proposal"]> };
};

/** Narrowed once, so every function below can read the proposal without asserting it. */
export function isAcceptedProposal(record: AcceptedRecord): record is ProposalRecordValue {
  return record.quote.proposal !== null;
}

function factsOf(record: ProposalRecordValue) {
  return {
    acceptedAt: record.acceptedAt,
    proposal: { termMonths: record.quote.proposal.termMonths },
    brief: record.work?.brief ?? null,
  };
}

export interface AgreedFact {
  key: "term" | "mobilisation" | "cadence" | "start" | "payment";
  label: string;
  value: string;
  /** Unstated, rendered grey rather than hidden. */
  muted: boolean;
}

/** *Proposal R1 · accepted inside its 30-day validity*, or the bare revision. */
export function agreedWindowLine(record: ProposalRecordValue): string {
  const { quote } = record;
  const inside =
    record.acceptedAt !== null && quote.expiresAt !== null && record.acceptedAt.getTime() <= quote.expiresAt.getTime();
  return inside
    ? t("accepted_proposal.window.inside", { revision: quote.revision, days: quote.validityDays })
    : t("accepted_proposal.window.revision", { revision: quote.revision });
}

/** The fee at display scale, in its three parts: `AED` · `18,400` · `per month, excluding VAT`. */
export function agreedAmount(record: ProposalRecordValue): { currency: string; figure: string; basis: string } {
  const proposal = record.quote.proposal;
  return {
    currency: t("proposal.currency"),
    figure: typedAmount(proposal.feeAed),
    basis: t("accepted_proposal.amount.basis", { basis: proposal.feeBasisLabel.toLowerCase() }),
  };
}

/** `24 months · 1 Nov 2026 to 31 Oct 2028` — both the duration and the dates (acceptance criterion 4). */
export function termLine(record: ProposalRecordValue): { value: string; muted: boolean } {
  const months = record.quote.proposal.termMonths;
  if (months === null) return { value: t("accepted_proposal.not_stated"), muted: true };
  const dates = termDates(factsOf(record));
  return dates
    ? {
        value: t("accepted_proposal.term.dated", {
          months: termWords(months),
          start: formatDate(dates.start),
          end: formatDate(dates.end),
        }),
        muted: false,
      }
    : // No start date was ever written down — *as soon as possible*, or no brief.
      { value: t("accepted_proposal.term.undated", { months: termWords(months) }), muted: false };
}

/**
 * The terms beside the fee, in the order the render gives them.
 *
 * An ongoing engagement shows its term and cadence; a one-off job or a call-off
 * has neither (§States) and shows when it starts instead — unless the supplier
 * stated a term anyway, which is then the supplier's term and is shown.
 */
export function agreedFacts(record: ProposalRecordValue): AgreedFact[] {
  const proposal = record.quote.proposal;
  const brief = record.work?.brief ?? null;
  const ongoing = isOngoing(factsOf(record));
  const facts: AgreedFact[] = [];

  if (ongoing) {
    const term = termLine(record);
    facts.push({ key: "term", label: t("accepted.proposal.term"), value: term.value, muted: term.muted });
  }
  facts.push({
    key: "mobilisation",
    label: t("accepted.proposal.mobilisation"),
    value: proposal.mobilisationAed === null ? t("accepted_proposal.not_stated") : mobilisationWords(proposal.mobilisationAed),
    muted: proposal.mobilisationAed === null,
  });
  if (ongoing) {
    facts.push({
      key: "cadence",
      label: t("accepted_proposal.cadence"),
      value: brief?.cadence
        ? t(`brief.cadence.${brief.cadence}` as MessageKey)
        : brief
          ? t("accepted_proposal.cadence_none")
          : t("accepted_proposal.cadence_no_brief"),
      muted: !brief?.cadence,
    });
  } else if (brief) {
    facts.push({
      key: "start",
      label: t("accepted_proposal.start"),
      value:
        brief.startMode === "from_date" && brief.startsOn ? formatDate(brief.startsOn) : t("track.brief.start_asap"),
      muted: false,
    });
  }
  return facts;
}

/** *Monthly in arrears* — the proposal's own term, or grey *Not stated on the proposal*. */
export function paymentLine(record: ProposalRecordValue): { value: string; muted: boolean } {
  const terms = record.quote.paymentTerms;
  return terms === null
    ? { value: t("accepted_proposal.not_stated"), muted: true }
    : { value: paymentTermsWords(terms), muted: false };
}

/**
 * *Where the work happens* — the buyer's site, from the brief. Two lines, the
 * way the goods record gives an address. Empty when the enquiry named no place.
 */
export function siteLines(record: ProposalRecordValue): string[] {
  const site = record.work?.site;
  if (!site) return [];
  const emirate = site.emirate ? (EMIRATES.find((e) => e.value === site.emirate)?.label ?? site.emirate) : "";
  const place = site.areaName ? t("brief.site_area", { area: site.areaName, emirate }) : emirate;
  const first = site.building
    ? t("accepted_proposal.site.building", { building: site.building })
    : t("accepted_proposal.site.yours");
  return place ? [first, place] : site.building ? [first] : [];
}

/** The summary under the supplier's name: engagement, fee on its basis, term. */
export function proposalSummaryParts(record: ProposalRecordValue): string[] {
  const proposal = record.quote.proposal;
  const brief = record.work?.brief ?? null;
  return [
    brief ? t(`engagement.${brief.engagementType}` as MessageKey) : null,
    // *AED 18,400 per month* — in a sentence of middots, the fee's own middot would split it in two.
    t("accepted_proposal.summary.fee", { amount: feeAmount(proposal.feeAed), basis: proposal.feeBasisLabel.toLowerCase() }),
    proposal.termMonths === null ? null : termWords(proposal.termMonths),
  ].filter((part): part is string => part !== null);
}

/* ── The rail ─────────────────────────────────────────────────────────────── */

export interface CommitmentLine {
  key: string;
  text: string;
  /** Where the words came from — `B6`, *labelled by source*. */
  source: string;
}

function commitmentLine(commitment: ProposalCommitment, record: ProposalRecordValue, ongoing: boolean): CommitmentLine {
  switch (commitment.kind) {
    case "start":
      return {
        key: "start",
        text: ongoing ? t("accepted_proposal.commit.start_term") : t("accepted_proposal.commit.start_work"),
        source: t("accepted_proposal.source.brief_dated", { when: formatDate(commitment.on) }),
      };
    case "mobilisation":
      return {
        key: "mobilisation",
        text: t("accepted_proposal.commit.mobilisation", { amount: mobilisationWords(commitment.aed) }),
        source: t("accepted_proposal.source.proposal"),
      };
    case "cadence":
      return {
        key: "cadence",
        text: t("accepted_proposal.commit.cadence", {
          cadence: t(`brief.cadence.${commitment.cadence}` as MessageKey).toLowerCase(),
        }),
        source: t("accepted_proposal.source.brief"),
      };
    case "turnaround":
      return {
        key: "turnaround",
        text: commitment.text,
        source: record.work?.turnaroundLabel
          ? t("accepted_proposal.source.scope_sheet_labelled", { label: record.work.turnaroundLabel })
          : t("accepted_proposal.source.scope_sheet"),
      };
    case "deliverable":
      return { key: "deliverable", text: commitment.text, source: t("accepted_proposal.source.deliverable") };
    case "delivered_where":
      return { key: "delivered_where", text: commitment.text, source: t("accepted_proposal.source.delivered_where") };
  }
}

/** `B6`: the proposal's fields as the rail lists them, each with its source. */
export function commitmentLines(record: ProposalRecordValue): CommitmentLine[] {
  const ongoing = isOngoing(factsOf(record));
  return proposalCommitments({ proposal: record.quote.proposal, brief: record.work?.brief ?? null }).map((c) =>
    commitmentLine(c, record, ongoing),
  );
}

export type ReviewTiming =
  | { open: true; eyebrow: string }
  | { open: false; eyebrow: string; body: string };

/** `B10`: the review card's eyebrow, and — until it opens — the day it does. */
export function reviewTiming(record: ProposalRecordValue, now: Date): ReviewTiming {
  const facts = factsOf(record);
  const eyebrow = isOngoing(facts)
    ? t(`accepted_proposal.review.after_${firstCycle(facts.brief?.cadence ?? null).unit}` as MessageKey)
    : t("accepted.review.eyebrow");
  const opens = reviewOpensOn(facts);
  // The gate's own rule, so the card never offers a form `canReview` refuses.
  if (opens !== null && !reviewOpen(facts, now)) {
    return { open: false, eyebrow, body: t("accepted_proposal.review.opens", { when: formatDate(opens) }) };
  }
  // Board 10f: and until it closes — the form is absent after, so the button is too.
  const window = acceptedWindow(facts.acceptedAt, opens, {
    ongoing: isOngoing(facts),
    termEndsOn: termDates(facts)?.end ?? null,
  });
  if (window && !windowOpen(window, now)) {
    return {
      open: false,
      eyebrow,
      body: t("accepted.review.closed", { when: formatDate(window.closesOn), days: REVIEW_WINDOW_DAYS }),
    };
  }
  return { open: true, eyebrow };
}

export interface ContractCardWords {
  tone: "neutral" | "warn";
  eyebrow: string;
  body: string;
  /** Whether to offer briefing again — near the end, or after it. */
  rebrief: boolean;
  /** Where the card sits: first in the rail once the term has started (§States). */
  leadsRail: boolean;
}

/**
 * *An ongoing contract is not one event.* The card that makes the page a
 * reference rather than a receipt, worded for where the calendar is. Null for a
 * one-off job, which is one event.
 */
export function contractCard(record: ProposalRecordValue, now: Date): ContractCardWords | null {
  const facts = factsOf(record);
  if (!isOngoing(facts)) return null;
  const supplier = record.supplier.displayName;
  const months = record.quote.proposal.termMonths;
  const phase: ContractPhase = contractPhase(facts, now);

  switch (phase.kind) {
    case "ending":
      return {
        tone: "warn",
        eyebrow: t("accepted_proposal.contract.ending_eyebrow", { count: phase.daysLeft, formatted: formatCount(phase.daysLeft) }),
        body: t("accepted_proposal.contract.ending_body", { end: formatDate(phase.end), supplier }),
        rebrief: true,
        leadsRail: true,
      };
    case "ended":
      return {
        tone: "neutral",
        eyebrow: t("accepted_proposal.contract.ended_eyebrow"),
        body: t("accepted_proposal.contract.ended_body", { end: formatDate(phase.end), supplier }),
        rebrief: true,
        leadsRail: true,
      };
    default:
      return {
        tone: "neutral",
        eyebrow: t("accepted_proposal.contract.eyebrow"),
        body:
          months === null
            ? t("accepted_proposal.contract.body_open_ended")
            : t("accepted_proposal.contract.body", { months: termWords(months) }),
        rebrief: false,
        leadsRail: phase.kind === "running",
      };
  }
}
