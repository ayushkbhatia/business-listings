import "server-only";
import { prisma } from "@/lib/db/client";
import { coveredLines } from "@/lib/enquiry/release";
import { quoteTotalFils } from "./money";

/**
 * Quoted value — the data model's `quotedValue`: the sum of accepted quote
 * lines, labelled self-reported everywhere it appears.
 *
 * Nothing summed it before board 4a asked. `Business.quotedValueAed` is written
 * by the seed and read by nothing, and the "marketplace health" screen
 * `lib/billing/revenue.ts` said held this figure was never built. This is the
 * one reader, and the overview and `/admin/quotes` both call it.
 *
 * ## What it is and is not
 *
 * The prices suppliers put on the quotes buyers accepted. The platform holds
 * none of that money, takes nothing from it and cannot check it: a supplier
 * types a price, a buyer accepts the quote, and whatever is paid afterwards is
 * paid directly between the two of them. So it is never revenue, never MRR and
 * never a figure on the revenue board, and every surface that prints it says
 * *self-reported*.
 *
 * - **The lines a buyer took.** After board `1o` a buyer can take some lines of
 *   a quote and the rest from another supplier, so an accepted quote counts
 *   its covered lines (`coveredLines`), at the quantity quoted. A quote
 *   accepted before `1o` marks no lines, and counts them all.
 * - **Proposals are counted, never summed.** A service proposal (`7c-s`) has a
 *   fee basis and a term and deliberately no total — summing its fee would be
 *   inventing the total that board refused to print. They are reported beside
 *   the value as a count.
 * - **By the month it was accepted**, Dubai time, which is when a buyer
 *   committed to it.
 */

export interface QuotedValue {
  /** The sum of accepted quote lines, in fils. Self-reported. */
  fils: number;
  /** Accepted quotes whose lines are summed into `fils`. */
  quotes: number;
  /** Accepted service proposals: counted, not summed. */
  proposals: number;
}

export interface SectorQuotedValue extends QuotedValue {
  /** The supplier's sector, or null where the listing is filed nowhere this taxonomy knows. */
  sectorId: string | null;
}

interface AcceptedRow {
  sectorId: string | null;
  acceptedAt: Date;
  isProposal: boolean;
  fils: bigint;
}

function empty(): QuotedValue {
  return { fils: 0, quotes: 0, proposals: 0 };
}

async function acceptedBetween(from: Date, to: Date): Promise<AcceptedRow[]> {
  const quotes = await prisma.quote.findMany({
    where: { status: "accepted", acceptedAt: { gte: from, lt: to } },
    select: {
      acceptedAt: true,
      proposal: { select: { quoteId: true } },
      lines: { select: { qty: true, unitPrice: true, acceptedAt: true } },
      business: { select: { sectorId: true, primaryCategoryId: true } },
    },
    orderBy: [{ acceptedAt: "asc" }, { id: "asc" }],
  });
  return quotes.map((quote) => {
    const isProposal = quote.proposal !== null;
    return {
      sectorId: quote.business.sectorId ?? quote.business.primaryCategoryId ?? null,
      acceptedAt: quote.acceptedAt!,
      isProposal,
      fils: isProposal
        ? 0n
        : quoteTotalFils(coveredLines(quote.lines).map((line) => ({ qty: line.qty, unitPrice: line.unitPrice.toString() }))),
    };
  });
}

function add(total: QuotedValue, row: AcceptedRow): void {
  if (row.isProposal) {
    total.proposals += 1;
    return;
  }
  total.quotes += 1;
  total.fils += Number(row.fils);
}

/** Accepted between `from` and `to`. */
export async function quotedValueIn(from: Date, to: Date): Promise<QuotedValue> {
  const total = empty();
  for (const row of await acceptedBetween(from, to)) add(total, row);
  return total;
}

/** The same, split by the supplier's sector. Sectors with nothing accepted are absent. */
export async function quotedValueBySector(from: Date, to: Date): Promise<SectorQuotedValue[]> {
  const bySector = new Map<string | null, SectorQuotedValue>();
  for (const row of await acceptedBetween(from, to)) {
    const entry = bySector.get(row.sectorId) ?? { sectorId: row.sectorId, ...empty() };
    add(entry, row);
    bySector.set(row.sectorId, entry);
  }
  return [...bySector.values()].sort((a, b) => b.fils - a.fils || b.quotes - a.quotes);
}

/** One figure per window, keyed as the caller keys them — Dubai months, for the overview's picker. */
export async function quotedValueByWindow(
  windows: readonly { key: string; from: Date; to: Date }[],
): Promise<Map<string, QuotedValue>> {
  const result = new Map(windows.map((window) => [window.key, empty()]));
  if (windows.length === 0) return result;
  const from = new Date(Math.min(...windows.map((window) => window.from.getTime())));
  const to = new Date(Math.max(...windows.map((window) => window.to.getTime())));
  for (const row of await acceptedBetween(from, to)) {
    const window = windows.find((candidate) => row.acceptedAt >= candidate.from && row.acceptedAt < candidate.to);
    if (window) add(result.get(window.key)!, row);
  }
  return result;
}
