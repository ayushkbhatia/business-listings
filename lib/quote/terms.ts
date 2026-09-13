import { DeliveryTerms, PaymentTerms } from "@/lib/db/generated/enums";

/**
 * The two terms a quote states beside its lines — board `7c`'s *payment agreed*
 * and *delivery included*.
 *
 * Both are optional on the quote and both render when absent: *Not stated on
 * the quote*. That is why the parsers return null for anything that is not a
 * value rather than falling back to a default — a Select with no placeholder
 * posts its first option, and a quote that silently said *Payment in advance*
 * because nobody touched the box is the platform writing a term into an
 * agreement.
 */

export type PaymentTermsValue = PaymentTerms;
export type DeliveryTermsValue = DeliveryTerms;

/** In the order a buyer reads them: cash first, then credit by length, then the instrument. */
export const PAYMENT_TERMS: readonly PaymentTermsValue[] = [
  PaymentTerms.advance,
  PaymentTerms.cod,
  PaymentTerms.net_15,
  PaymentTerms.net_30,
  PaymentTerms.net_60,
  PaymentTerms.lc,
];

export const DELIVERY_TERMS: readonly DeliveryTermsValue[] = [
  DeliveryTerms.included,
  DeliveryTerms.charged_separately,
  DeliveryTerms.collection,
];

export function parsePaymentTerms(value: unknown): PaymentTermsValue | null {
  return typeof value === "string" && (PAYMENT_TERMS as readonly string[]).includes(value)
    ? (value as PaymentTermsValue)
    : null;
}

export function parseDeliveryTerms(value: unknown): DeliveryTermsValue | null {
  return typeof value === "string" && (DELIVERY_TERMS as readonly string[]).includes(value)
    ? (value as DeliveryTermsValue)
    : null;
}
