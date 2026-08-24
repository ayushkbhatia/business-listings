import { delta, parseAedToFils, quoteTotalFils } from "@/lib/quote/money";
import type { ThreadQuoteView } from "@/components/domain";

/**
 * Turning quote rows into what the thread renders.
 *
 * A revision is a new row, so "what changed" is a comparison between two of
 * them, and it is computed once here rather than on each side. The buyer and
 * the seller must see the same two numbers: if the seller's screen says the
 * price came down six per cent and the buyer's says five, the record is worth
 * nothing.
 */

export interface QuoteForThread {
  id: string;
  ref: string;
  revision: number;
  lines: readonly { qty: number; unitPrice: string }[];
}

export interface DeltaLabels {
  down: (amount: string, percent: string) => string;
  up: (amount: string, percent: string) => string;
  same: string;
}

/**
 * @param quotes every revision from one supplier, any order.
 * @param formatAed formats a decimal string for display.
 */
export function toThreadQuotes(
  quotes: readonly QuoteForThread[],
  formatAed: (aed: string) => string,
  labels: DeltaLabels,
): Map<string, ThreadQuoteView> {
  const ordered = [...quotes].sort((a, b) => a.revision - b.revision);
  const views = new Map<string, ThreadQuoteView>();

  ordered.forEach((quote, index) => {
    const total = quoteTotalFils(quote.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })));
    const previous = index === 0 ? null : ordered[index - 1]!;

    if (!previous) {
      views.set(quote.id, {
        ref: quote.ref,
        revision: quote.revision,
        totalLabel: formatAed(filsToDecimal(total)),
      });
      return;
    }

    const previousTotal = quoteTotalFils(
      previous.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
    );
    const change = delta(previousTotal, total);
    const amount = formatAed(filsToDecimal(change.fils < 0n ? -change.fils : change.fils));
    const percent = change.percent === null ? "" : String(Math.abs(change.percent));

    views.set(quote.id, {
      ref: quote.ref,
      revision: quote.revision,
      totalLabel: formatAed(filsToDecimal(total)),
      previousTotalLabel: formatAed(filsToDecimal(previousTotal)),
      deltaLabel:
        change.direction === "same"
          ? labels.same
          : change.direction === "down"
            ? labels.down(amount, percent)
            : labels.up(amount, percent),
      direction: change.direction,
    });
  });

  return views;
}

function filsToDecimal(fils: bigint): string {
  const negative = fils < 0n;
  const abs = negative ? -fils : fils;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

export { parseAedToFils };
