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
  lines: readonly { qty: number | null; unitPrice: string }[];
  /**
   * Board `3j-s`: the fee, when this revision is a proposal. It has no lines,
   * so its figure is the fee — and two revisions compare only on the same basis.
   */
  proposal?: { feeAed: string; feeBasis: string; feeBasisLabel: string } | null;
}

/** The figure a revision stands for, and the basis it is on (null for a sum of lines). */
function figureOf(quote: QuoteForThread): { fils: bigint; basis: string | null } {
  if (quote.proposal) return { fils: parseAedToFils(quote.proposal.feeAed), basis: quote.proposal.feeBasis };
  return { fils: quoteTotalFils(quote.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice }))), basis: null };
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
  /** How a proposal's fee reads — `AED 18,400 · Per month`. Defaults to the amount alone. */
  feeLabel?: (proposal: NonNullable<QuoteForThread["proposal"]>) => string,
): Map<string, ThreadQuoteView> {
  const ordered = [...quotes].sort((a, b) => a.revision - b.revision);
  const views = new Map<string, ThreadQuoteView>();
  const labelOf = (quote: QuoteForThread, fils: bigint) =>
    quote.proposal && feeLabel ? feeLabel(quote.proposal) : formatAed(filsToDecimal(fils));

  ordered.forEach((quote, index) => {
    const { fils: total, basis } = figureOf(quote);
    const previous = index === 0 ? null : ordered[index - 1]!;
    const before = previous ? figureOf(previous) : null;

    /*
       Nothing to compare against: the first revision, or a previous one on a
       different basis. `18,400 per month` after `210,000 fixed fee` is not
       *191,600 lower*, and a struck-through figure in another unit would say it
       was.
    */
    if (!previous || !before || before.basis !== basis) {
      views.set(quote.id, {
        ref: quote.ref,
        revision: quote.revision,
        totalLabel: labelOf(quote, total),
      });
      return;
    }

    const previousTotal = before.fils;
    const change = delta(previousTotal, total);
    const amount = formatAed(filsToDecimal(change.fils < 0n ? -change.fils : change.fils));
    const percent = change.percent === null ? "" : String(Math.abs(change.percent));

    views.set(quote.id, {
      ref: quote.ref,
      revision: quote.revision,
      totalLabel: labelOf(quote, total),
      previousTotalLabel: labelOf(previous, previousTotal),
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
