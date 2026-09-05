import "server-only";
import { prisma } from "@/lib/db/client";
import { supplyWhere, type LandingScope } from "./scope";

/**
 * Board 6a, open question 2 — the aggregate quote range, and the switch it is
 * behind.
 *
 *   *"May we publish aggregate quote ranges at all? The FAQ row exposes what
 *    sellers quoted through the platform. `3k` owns quote data and no seller
 *    has agreed to have it aggregated publicly. Decide before `6a` ships. If
 *    yes, min sample 30, 12-month window, scope-level only, and it goes in the
 *    seller terms. If undecided, ship the page without that row."*
 *
 * It is undecided, so the page ships without the row: `PUBLIC_QUOTE_AGGREGATES`
 * defaults **off** and this returns null. The machinery is here rather than
 * absent for two reasons. The first is that criterion 11 — *"the quote-range
 * FAQ row is absent below the 30-quote minimum sample, and states its window
 * when present"* — is a rule about behaviour that has to be testable in both
 * states, and a feature that does not exist cannot be. The second is that the
 * answer to the question is a sentence in the seller terms plus one row in
 * `platform_setting`, and it should not also be a deploy.
 *
 * ## What it does not do
 *
 * It does not publish a price on a public surface. The no-price rule is about a
 * `Product` carrying a number a buyer can act on before a seller has seen the
 * requirement; this is a range across at least thirty private `QuoteLine` rows
 * over a year, attributable to nobody, in an answer that says so. The two are
 * different claims and the distinction is the reason for the sample floor: at
 * four quotes it *is* a price, wearing an average's clothes.
 *
 * ## Why the row disappears rather than degrading
 *
 * §States: *"below the 30-quote minimum sample the row **does not render**. It
 * does not render a range from 4 quotes and it does not say 'not enough
 * data'."* A missing question is honest; a question answered with a hedge is
 * the spun text the whole gate exists to keep out.
 */

/** The row in `platform_setting` that answers open question 2. */
export const PUBLIC_QUOTE_AGGREGATES_KEY = "public_quote_aggregates";

/** Below this a range is a handful of deals, not a market. */
export const MIN_QUOTE_SAMPLE = 30;

/** A year. Older than that and it is describing a different market. */
export const QUOTE_WINDOW_MONTHS = 12;

export interface QuoteRange {
  /** Whole dirhams. The line total, not a unit price. */
  low: number;
  high: number;
  /** Said out loud in the answer: a range with no sample is not a fact. */
  sample: number;
  windowMonths: number;
}

/**
 * Off unless somebody has turned it on, and a malformed value reads as off.
 *
 * The safe direction is unambiguous here: the failure of reading this wrongly
 * is publishing what sellers priced privately, on the highest-traffic template
 * we own, without their agreement.
 */
export async function quoteAggregatesEnabled(): Promise<boolean> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: PUBLIC_QUOTE_AGGREGATES_KEY },
    select: { value: true },
  });
  return row?.value === true;
}

export async function quoteRangeFor(
  scope: LandingScope,
  now = new Date(),
): Promise<QuoteRange | null> {
  if (!(await quoteAggregatesEnabled())) return null;

  const since = new Date(now);
  since.setMonth(since.getMonth() - QUOTE_WINDOW_MONTHS);

  /*
     Sent quotes only, from suppliers on this page, priced inside the window.

     A draft is a number a seller has not stood behind, and a quote from a
     supplier who is not in this scope is not a fact about this scope. The
     figure is the line total — quantity times unit price — because "AED 6,000
     to AED 22,000 per chiller" is what a buyer is asking about, not the unit
     rate of a component of it.
  */
  const lines = await prisma.quoteLine.findMany({
    where: {
      quote: {
        sentAt: { gte: since, lte: now },
        status: { not: "draft" },
        business: supplyWhere(scope),
      },
    },
    select: { qty: true, unitPrice: true },
  });

  if (lines.length < MIN_QUOTE_SAMPLE) return null;

  const totals = lines.map((line) => Number(line.unitPrice) * line.qty).sort((a, b) => a - b);

  /*
     The tenth and ninetieth percentile, not the minimum and maximum.

     One mis-keyed line at AED 4 and one at AED 900,000 would otherwise be the
     whole range, and a range nobody recognises is worse than no range: the
     first buyer who reads it stops trusting every other number on the page.
  */
  const low = totals[Math.floor(totals.length * 0.1)] as number;
  const high = totals[Math.min(totals.length - 1, Math.ceil(totals.length * 0.9))] as number;

  return {
    low: Math.round(low),
    high: Math.round(high),
    sample: totals.length,
    windowMonths: QUOTE_WINDOW_MONTHS,
  };
}
