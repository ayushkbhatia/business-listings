import { formatDate } from "@/lib/format";
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
  return t(ended ? "accepted.window.expired" : "accepted.window.held", {
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

/** The lead time as the supplier gave it. Zero days is ex-stock, which is how the trade says it. */
export function leadTime(days: number | null): string {
  if (days === null) return t("accepted.not_stated");
  if (days === 0) return t("accepted.lead.ex_stock");
  return t("accepted.lead.days", { count: days });
}
