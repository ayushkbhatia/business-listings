import { parseAedToFils, quoteTotalFils, type PricedLine } from "@/lib/quote/money";

/**
 * Board `7b` — the one figure a quote commits the company to, for the gate.
 *
 * A quote for things totals its lines, excluding VAT, exactly as the
 * comparison and the accepted record do (`quoteTotalFils`).
 *
 * A proposal has a total only on a **fixed fee**: the fee, plus mobilisation
 * where the supplier declared one — two amounts the supplier wrote, added, not
 * a fee multiplied by anything. Every other basis — per month, per visit, per
 * hour, a retainer — has no single total, and `proposal-footing.ts` stays the
 * only place in the product that multiplies a fee. The gate reads the null as
 * *counts as over every limit* rather than inventing a year.
 */
export interface ValuedQuote {
  lines: readonly PricedLine[];
  proposal: {
    feeBasis: string | null;
    feeAed: string | null;
    mobilisationAed: string | null;
  } | null;
}

export function commitmentFils(quote: ValuedQuote): bigint | null {
  if (quote.proposal) {
    const { feeBasis, feeAed, mobilisationAed } = quote.proposal;
    if (feeBasis !== "fixed_fee" || feeAed === null) return null;
    return parseAedToFils(feeAed) + (mobilisationAed === null ? 0n : parseAedToFils(mobilisationAed));
  }
  return quoteTotalFils(quote.lines);
}

