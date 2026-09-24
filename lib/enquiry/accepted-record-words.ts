import { formatAED, formatDate } from "@/lib/format";
import { feeOnBasis } from "@/lib/quote/proposal-words";
import { t } from "@/lib/i18n";
import { windowExpired, type AcceptedRecord } from "./accepted-record";

/**
 * The three phrases the record page and the quote PDF both print, worded once.
 *
 * `B7` asks the PDF and the page to show identical figures; these are the words
 * around the figures, and two copies of *price held 14 days from 21 Aug* are two
 * chances for the document a buyer forwards to say something the page does not.
 */

/** *Revision 2 · price held 14 days from 21 Aug*, or its ended form. */
export function windowLine(record: AcceptedRecord, now: Date): string {
  const quote = record.quote;
  if (!quote.sentAt) return t("accepted.window.revision", { revision: quote.revision });
  const ended = windowExpired(quote.expiresAt, now) && quote.expiresAt !== null;
  // A proposal holds a fee and a scope, not a price on a line.
  const key = quote.proposal
    ? ended
      ? "accepted.window.proposal_expired"
      : "accepted.window.proposal_held"
    : ended
      ? "accepted.window.expired"
      : "accepted.window.held";
  return t(key, {
    revision: quote.revision,
    days: quote.validityDays,
    from: formatDate(quote.sentAt),
    ended: quote.expiresAt ? formatDate(quote.expiresAt) : "",
  });
}

/** *Total excl. VAT · delivery included*, with the delivery half only when the quote stated it. */
export function totalLabel(record: AcceptedRecord): string {
  const delivery = record.quote.delivery;
  return delivery
    ? t("accepted.total_with_delivery", {
        delivery: t(`accepted.delivery.${delivery}` as "accepted.delivery.included"),
      })
    : t("accepted.total");
}

/** The summary under the name: a fee on its basis for a proposal, a line count and a total for a quote. */
export function recordSummaryParts(record: AcceptedRecord): string[] {
  const proposal = record.quote.proposal;
  return proposal
    ? [feeOnBasis(proposal)]
    : [
        t("accepted.summary.lines", { count: record.quote.lines.length }),
        t("accepted.summary.total", { total: formatAED(record.quote.totalAed) }),
      ];
}

/** The lead time as the supplier gave it. Zero days is ex-stock, which is how the trade says it. */
export function leadTime(days: number | null): string {
  if (days === null) return t("accepted.not_stated");
  if (days === 0) return t("accepted.lead.ex_stock");
  return t("accepted.lead.days", { count: days });
}

/**
 * Why the review card offers no button, where the reason is the reader rather
 * than the calendar. Build plan 9.4's matrix refuses the person
 * (`not_permitted`); `canReview` refuses the subject when it is the business the
 * reader's own seat is on (`own_business`) — no supplier reviews itself.
 */
export type ReviewRefusal = "not_permitted" | "own_business";

export function reviewRefusalWords(refusal: ReviewRefusal, supplierName: string): string {
  return refusal === "own_business"
    ? t("accepted.review.own_business", { supplier: supplierName })
    : t("reviewwrite.error.not_permitted");
}
