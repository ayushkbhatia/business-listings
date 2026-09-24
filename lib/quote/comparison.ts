import { dubaiDayStart } from "@/lib/format/date";
import { lineTotalFils, parseAedToFils } from "./money";

/**
 * Board `1n` — the quotes on one enquiry, compared line by line.
 *
 * Pure: no database, no `t()`, and no clock but the `now` handed in. The page,
 * the gallery and the CSV export all read one `QuoteComparisonModel`, so the
 * screen and the file a buyer downloads cannot disagree about a figure.
 *
 * ## What the board is for
 *
 * *Priced per line* is what makes the screen worth building: one supplier wins
 * the valve, another the coupling, and neither wins overall. So every figure
 * here is a cell — a supplier's price for one of the buyer's lines — and every
 * total is a sum of cells computed at read time (`7c` B2). Nothing is stored.
 *
 * ## The rules, each from a note on the board
 *
 * - **Cells are keyed on `QuoteLine.enquiryLineId`**, never on the wording. A
 *   seller rewrites a description in their own words; matching words is how a
 *   DN150 price lands in a DN100 row. A quote line with no line to answer — one
 *   written before board 3j, or a line the seller added — is counted in that
 *   supplier's total and reported as such, never guessed onto a column.
 * - **A cell is comparable only at the quantity asked** (`B5`). A supplier who
 *   priced 50 where the buyer asked for 40 answered a different question, and
 *   its total cannot be the cheapest of a column it is not the same size as.
 * - **Every line's winner is marked** (`B2`): the lowest comparable cell among
 *   quotes that can still be accepted, ties broken by the shorter lead time and
 *   then by the earlier quote. The marks are the audit trail for the card.
 * - **The cheapest-per-line figure is computed from those marks** (`B1`, `B3`).
 *   It names only the suppliers it needs, its delivery count is the count of
 *   distinct suppliers, and its saving is against the best *complete* single
 *   quote — the board drew 13,680 across three suppliers by hand when the
 *   winners said 13,560 across two.
 * - **An incomplete quote is never compared on its total alone** (`B5`): any
 *   sort by total puts complete quotes first.
 *
 * Accepting splits nothing. One enquiry has one accepted quote (decided 24 Sep
 * 2026): the card is a figure to negotiate with, not a basket to accept.
 */

/** One line of the buyer's requirement — a column of the table. */
export interface RequestedLine {
  id: string;
  description: string;
  /** Null is unquantified: work priced as a whole, not zero. */
  qty: number | null;
  unit: string | null;
  size: string | null;
}

/** One line of a supplier's quote, as stored. */
export interface QuotedLine {
  /** The buyer's line this answers. Null on a line with nothing to answer. */
  enquiryLineId: string | null;
  qty: number | null;
  /** A Decimal string — `"198.00"`. */
  unitPrice: string;
  leadTimeDays: number | null;
}

export interface ComparedSupplier {
  businessId: string;
  slug: string;
  /** Seller identity is `displayName`, on every surface. */
  displayName: string;
  /** As stored — the tier every other badge on the platform reads. */
  verificationTier: number;
  verifiedAt: Date | null;
  /** Measured from published reviews. Null with none — never a zero rendered as a rating. */
  rating: { average: number; count: number } | null;
  /** Board 11i: the supplier closed their account, so nothing of theirs can be accepted. */
  closed: boolean;
}

export interface ComparedQuote {
  id: string;
  /** `QT-8841-R2`. */
  ref: string;
  revision: number;
  /** `QuoteStatus`: sent, read, accepted, lost, expired. Never a draft. */
  status: string;
  /** When this revision was sent. */
  sentAt: Date;
  /** When the supplier first quoted at all — revision 1's send. */
  firstSentAt: Date;
  expiresAt: Date | null;
  /** The requirement revision this was priced against. */
  againstRevision: number;
  paymentTerms: string | null;
  delivery: string | null;
  lines: QuotedLine[];
}

/** One supplier the enquiry reached, with their quote if they sent one. */
export interface ComparedRecipient {
  supplier: ComparedSupplier;
  /** `RecipientState`: delivered, opened, quoted, declined, no_response. */
  state: string;
  /** When the enquiry reached them — what "quoted in" is measured from. */
  deliveredAt: Date;
  openedAt: Date | null;
  buyerNudgedAt: Date | null;
  /** Their first reply of any kind — measured, never typed. A message counts. */
  repliedAt: Date | null;
  /** Set when the supplier declined themselves (`3j-s`), not when the buyer chose another. */
  declinedAt: Date | null;
  declineReason: string | null;
  quote: ComparedQuote | null;
}

export interface ComparisonInput {
  lines: RequestedLine[];
  recipients: ComparedRecipient[];
  /** `Enquiry.revision` — a quote priced against an earlier one is marked. */
  revision: number;
  closesAt: Date;
  neededBy: Date | null;
  /** `Enquiry.contactReleasedToBusinessId`. */
  acceptedBusinessId: string | null;
  acceptedAt: Date | null;
}

export type SortKey = "received" | "total" | "lead";
export const SORT_KEYS: readonly SortKey[] = ["received", "total", "lead"];

export function readSort(value: string | null | undefined): SortKey {
  return (SORT_KEYS as readonly string[]).includes(value ?? "") ? (value as SortKey) : "received";
}

/** Where a quote stands, for the row and for whether it may be accepted. */
export type QuoteState =
  /** Sent, inside its window, on an enquiry still open: acceptable. */
  | "open"
  | "accepted"
  /** Lost because the buyer accepted somebody else. */
  | "declined"
  | "expired"
  /** The supplier closed their account (board 11i). */
  | "supplier_closed"
  /** The enquiry closed before anybody was accepted (`10e` B3). */
  | "closed";

export type Cell =
  | {
      kind: "priced";
      lineId: string;
      totalFils: bigint;
      /** Null when the supplier priced the line in more than one part. */
      unitFils: bigint | null;
      /** The quantity priced — the sum of the parts. Null is priced as a whole. */
      qty: number | null;
      /** How many quote lines answer this one. Two is an ex-stock part and an indent part. */
      parts: number;
      /** Priced at the quantity the buyer asked for, so its total can stand in the column. */
      comparable: boolean;
      /** The slowest part. Null when no part states one. */
      leadTimeDays: number | null;
      /** The lowest comparable cell in its column among acceptable quotes (`B2`). */
      winner: boolean;
    }
  | { kind: "not_quoted"; lineId: string };

export interface QuotedRow {
  kind: "quoted";
  supplier: ComparedSupplier;
  quote: ComparedQuote;
  state: QuoteState;
  cells: Cell[];
  /** Cells priced, of `totalLines`. */
  quotedLines: number;
  totalLines: number;
  /** Every line priced. */
  complete: boolean;
  /** Every line priced at the quantity asked — the only kind of quote a total can be ranked on. */
  comparable: boolean;
  /** Every quote line, including any with no line to answer. What the supplier would invoice. */
  totalFils: bigint;
  /** The cells alone. Equal to `totalFils` unless the supplier added lines of their own. */
  linesFils: bigint;
  /** Quote lines answering none of the buyer's lines, and what they add. */
  extraLines: number;
  extraFils: bigint;
  /** The slowest line of the quote — when everything would be in hand. Null when none states one. */
  leadTimeDays: number | null;
  /** First quote minus delivery, measured. */
  quotedInMs: number;
  /** Priced against an earlier revision of the requirement (`1i`). */
  superseded: boolean;
}

export interface WaitingRow {
  kind: "waiting";
  supplier: ComparedSupplier;
  /** `delivered` or `opened`. */
  state: "delivered" | "opened";
  deliveredAt: Date;
  openedAt: Date | null;
  buyerNudgedAt: Date | null;
  /** They wrote in the thread without quoting — answered, so never nudged. */
  repliedAt: Date | null;
}

export interface NoQuoteRow {
  kind: "no_quote";
  supplier: ComparedSupplier;
  /** The supplier said no, in their own words or none. */
  declinedBySupplier: boolean;
  declineReason: string | null;
  declinedAt: Date | null;
}

export type ComparisonRow = QuotedRow | WaitingRow | NoQuoteRow;

/** The cheapest-per-line card (`B1`–`B3`). */
export interface CheapestSplit {
  /** Each line's winner, in line order. */
  picks: { lineId: string; businessId: string; totalFils: bigint }[];
  /** Only the suppliers the split needs, in the order of the first line each wins. */
  suppliers: ComparedSupplier[];
  /** The count of distinct suppliers — derived, never written (`B3`). */
  deliveries: number;
  totalFils: bigint;
  /** The best complete single quote, and how far under it the split lands. Null when none is complete. */
  against: { supplier: ComparedSupplier; totalFils: bigint; savingFils: bigint } | null;
}

export type EnquiryPhase = "open" | "accepted" | "closed";

export interface QuoteComparisonModel {
  phase: EnquiryPhase;
  lines: RequestedLine[];
  rows: ComparisonRow[];
  sort: SortKey;
  /** Suppliers the enquiry reached. */
  sentTo: number;
  /** Suppliers who sent a quote, in any state. */
  quoted: number;
  /** Quotes that may be accepted right now. */
  acceptable: number;
  cheapest: CheapestSplit | null;
  acceptedBusinessId: string | null;
}

/**
 * Build the whole comparison.
 *
 * `sort` reorders rows and nothing else — winners, the card and every total are
 * computed before it and do not move with it.
 */
export function buildComparison(input: ComparisonInput, now: Date, sort: SortKey = "received"): QuoteComparisonModel {
  const phase: EnquiryPhase = input.acceptedBusinessId
    ? "accepted"
    : input.closesAt.getTime() <= now.getTime()
      ? "closed"
      : "open";

  const quotedRows: QuotedRow[] = [];
  const waiting: WaitingRow[] = [];
  const noQuote: NoQuoteRow[] = [];

  for (const recipient of input.recipients) {
    if (recipient.quote) {
      quotedRows.push(quotedRow(recipient, recipient.quote, input, phase, now));
      continue;
    }
    // A supplier who never quoted, on an enquiry that is decided or closed, is
    // history rather than somebody still being waited on.
    const stillWaiting =
      phase === "open" && !recipient.declinedAt && (recipient.state === "delivered" || recipient.state === "opened");
    if (stillWaiting) {
      waiting.push({
        kind: "waiting",
        supplier: recipient.supplier,
        state: recipient.state as "delivered" | "opened",
        deliveredAt: recipient.deliveredAt,
        openedAt: recipient.openedAt,
        buyerNudgedAt: recipient.buyerNudgedAt,
        repliedAt: recipient.repliedAt,
      });
    } else {
      noQuote.push({
        kind: "no_quote",
        supplier: recipient.supplier,
        declinedBySupplier: recipient.declinedAt !== null,
        declineReason: recipient.declineReason,
        declinedAt: recipient.declinedAt,
      });
    }
  }

  markWinners(quotedRows, input.lines);
  const cheapest = phase === "open" ? cheapestSplit(quotedRows, input.lines) : null;

  return {
    phase,
    lines: input.lines,
    rows: [...sortQuoted(quotedRows, sort), ...sortWaiting(waiting), ...sortNoQuote(noQuote)],
    sort,
    sentTo: input.recipients.length,
    quoted: quotedRows.length,
    acceptable: quotedRows.filter((row) => row.state === "open").length,
    cheapest,
    acceptedBusinessId: input.acceptedBusinessId,
  };
}

function quoteState(
  recipient: ComparedRecipient,
  quote: ComparedQuote,
  input: ComparisonInput,
  phase: EnquiryPhase,
  now: Date,
): QuoteState {
  if (quote.status === "accepted" || input.acceptedBusinessId === recipient.supplier.businessId) return "accepted";
  if (phase === "accepted" || quote.status === "lost") return "declined";
  if (quote.status === "expired" || (quote.expiresAt !== null && quote.expiresAt.getTime() < now.getTime())) {
    return "expired";
  }
  if (recipient.supplier.closed) return "supplier_closed";
  if (phase === "closed") return "closed";
  return "open";
}

function quotedRow(
  recipient: ComparedRecipient,
  quote: ComparedQuote,
  input: ComparisonInput,
  phase: EnquiryPhase,
  now: Date,
): QuotedRow {
  const cells = input.lines.map((line) => cellFor(line, quote.lines.filter((part) => part.enquiryLineId === line.id)));
  const known = new Set(input.lines.map((line) => line.id));
  const extras = quote.lines.filter((part) => part.enquiryLineId === null || !known.has(part.enquiryLineId));

  const totalFils = quote.lines.reduce((sum, part) => sum + lineTotalFils(part), 0n);
  const linesFils = cells.reduce((sum, cell) => (cell.kind === "priced" ? sum + cell.totalFils : sum), 0n);
  const quotedLines = cells.filter((cell) => cell.kind === "priced").length;
  const stated = quote.lines.map((part) => part.leadTimeDays).filter((days): days is number => days !== null);

  return {
    kind: "quoted",
    supplier: recipient.supplier,
    quote,
    state: quoteState(recipient, quote, input, phase, now),
    cells,
    quotedLines,
    totalLines: input.lines.length,
    complete: quotedLines === input.lines.length,
    comparable: cells.every((cell) => cell.kind === "priced" && cell.comparable),
    totalFils,
    linesFils,
    extraLines: extras.length,
    extraFils: extras.reduce((sum, part) => sum + lineTotalFils(part), 0n),
    leadTimeDays: stated.length > 0 ? Math.max(...stated) : null,
    quotedInMs: Math.max(0, quote.firstSentAt.getTime() - recipient.deliveredAt.getTime()),
    superseded: quote.againstRevision < input.revision,
  };
}

function cellFor(line: RequestedLine, parts: QuotedLine[]): Cell {
  if (parts.length === 0) return { kind: "not_quoted", lineId: line.id };
  const totalFils = parts.reduce((sum, part) => sum + lineTotalFils(part), 0n);
  const stated = parts.map((part) => part.leadTimeDays).filter((days): days is number => days !== null);
  return {
    kind: "priced",
    lineId: line.id,
    totalFils,
    unitFils: parts.length === 1 ? parseAedToFils(parts[0]!.unitPrice) : null,
    ...quantityOf(line, parts),
    parts: parts.length,
    leadTimeDays: stated.length > 0 ? Math.max(...stated) : null,
    winner: false,
  };
}

/**
 * The quantity a supplier priced a line at, and whether it is the one asked.
 *
 * Parts add up. An unquantified line — work priced as a whole — is answered in
 * kind by lump sums, which add up too. A counted part beside a lump sum is not
 * a quantity at all, so it answers nothing a column can compare.
 */
function quantityOf(line: RequestedLine, parts: QuotedLine[]): { qty: number | null; comparable: boolean } {
  const counted = parts.filter((part) => part.qty !== null);
  if (counted.length === 0) return { qty: null, comparable: line.qty === null };
  if (counted.length < parts.length) return { qty: null, comparable: false };
  const qty = counted.reduce((sum, part) => sum + part.qty!, 0);
  return { qty, comparable: qty === line.qty };
}

/**
 * The winner of each column, among quotes still acceptable.
 *
 * Lowest comparable total; then the shorter lead time, a stated one beating
 * none; then the earlier quote; then the business id, so two identical cells
 * still produce one mark rather than a coin toss that differs between renders.
 */
function markWinners(rows: QuotedRow[], lines: RequestedLine[]): void {
  const contenders = rows.filter((row) => row.state === "open");
  lines.forEach((_, index) => {
    let best: { row: QuotedRow; cell: Extract<Cell, { kind: "priced" }> } | null = null;
    for (const row of contenders) {
      const cell = row.cells[index];
      if (!cell || cell.kind !== "priced" || !cell.comparable) continue;
      if (!best || beats(cell, row, best.cell, best.row)) best = { row, cell };
    }
    if (best) best.cell.winner = true;
  });
}

function beats(
  cell: Extract<Cell, { kind: "priced" }>,
  row: QuotedRow,
  bestCell: Extract<Cell, { kind: "priced" }>,
  bestRow: QuotedRow,
): boolean {
  if (cell.totalFils !== bestCell.totalFils) return cell.totalFils < bestCell.totalFils;
  const lead = compareLead(cell.leadTimeDays, bestCell.leadTimeDays);
  if (lead !== 0) return lead < 0;
  const sent = row.quote.sentAt.getTime() - bestRow.quote.sentAt.getTime();
  if (sent !== 0) return sent < 0;
  return row.supplier.businessId < bestRow.supplier.businessId;
}

/** A stated lead time beats none; a shorter one beats a longer one. */
function compareLead(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function cheapestSplit(rows: QuotedRow[], lines: RequestedLine[]): CheapestSplit | null {
  if (lines.length === 0) return null;
  const picks: CheapestSplit["picks"] = [];
  for (const [index, line] of lines.entries()) {
    const winner = rows.find((row) => {
      const cell = row.cells[index];
      return cell?.kind === "priced" && cell.winner;
    });
    // A line nobody priced comparably: no split covers the requirement, so the
    // card has no figure to state and is not drawn.
    if (!winner) return null;
    const cell = winner.cells[index] as Extract<Cell, { kind: "priced" }>;
    picks.push({ lineId: line.id, businessId: winner.supplier.businessId, totalFils: cell.totalFils });
  }

  const suppliers: ComparedSupplier[] = [];
  for (const pick of picks) {
    if (suppliers.some((supplier) => supplier.businessId === pick.businessId)) continue;
    suppliers.push(rows.find((row) => row.supplier.businessId === pick.businessId)!.supplier);
  }
  // Every line won by one supplier is that supplier's own quote, not a split.
  if (suppliers.length < 2) return null;

  const totalFils = picks.reduce((sum, pick) => sum + pick.totalFils, 0n);
  const single = rows
    .filter((row) => row.state === "open" && row.comparable)
    .reduce<QuotedRow | null>((best, row) => (!best || row.linesFils < best.linesFils ? row : best), null);
  const against = single
    ? { supplier: single.supplier, totalFils: single.linesFils, savingFils: single.linesFils - totalFils }
    : null;
  // Level with the best single quote is no reason to split.
  if (against && against.savingFils <= 0n) return null;

  return { picks, suppliers, deliveries: suppliers.length, totalFils, against };
}

function sortQuoted(rows: QuotedRow[], sort: SortKey): QuotedRow[] {
  const received = (a: QuotedRow, b: QuotedRow) =>
    a.quote.firstSentAt.getTime() - b.quote.firstSentAt.getTime() || a.supplier.businessId.localeCompare(b.supplier.businessId);
  // What may still be accepted reads first under every order; history after it.
  const live = (row: QuotedRow) => (row.state === "open" || row.state === "accepted" ? 0 : 1);

  return [...rows].sort((a, b) => {
    const standing = live(a) - live(b);
    if (standing !== 0) return standing;
    if (sort === "total") {
      // `B5`: a complete quote is never ranked beside an incomplete one on total.
      const shape = Number(!a.comparable) - Number(!b.comparable);
      if (shape !== 0) return shape;
      if (!a.comparable && a.quotedLines !== b.quotedLines) return b.quotedLines - a.quotedLines;
      if (a.linesFils !== b.linesFils) return a.linesFils < b.linesFils ? -1 : 1;
    }
    if (sort === "lead") {
      const lead = compareLead(a.leadTimeDays, b.leadTimeDays);
      if (lead !== 0) return lead;
    }
    return received(a, b);
  });
}

function sortWaiting(rows: WaitingRow[]): WaitingRow[] {
  // Opened first: a supplier reading it is closer to a quote than one who has not looked.
  return [...rows].sort(
    (a, b) =>
      Number(a.state !== "opened") - Number(b.state !== "opened") ||
      a.deliveredAt.getTime() - b.deliveredAt.getTime() ||
      a.supplier.businessId.localeCompare(b.supplier.businessId),
  );
}

function sortNoQuote(rows: NoQuoteRow[]): NoQuoteRow[] {
  return [...rows].sort((a, b) => a.supplier.displayName.localeCompare(b.supplier.displayName));
}

/**
 * Whether a lead time lands inside the buyer's own date — flag 6's missing
 * threshold. The boundary is the one the buyer stated, `neededBy`, counted in
 * Dubai calendar days from today; with no date there is no boundary, and no
 * colour pretends to one.
 */
export function leadTone(leadTimeDays: number | null, neededBy: Date | null, now: Date): "ok" | "late" | "none" {
  if (leadTimeDays === null || neededBy === null) return "none";
  const arrives = dubaiDayStart(now).getTime() + leadTimeDays * 86_400_000;
  return arrives <= dubaiDayStart(neededBy).getTime() ? "ok" : "late";
}

/** The winner marks and the card agree: a unit test holds them to it. */
export function winnersOf(model: QuoteComparisonModel): Map<string, string> {
  const winners = new Map<string, string>();
  for (const row of model.rows) {
    if (row.kind !== "quoted") continue;
    for (const cell of row.cells) if (cell.kind === "priced" && cell.winner) winners.set(cell.lineId, row.supplier.businessId);
  }
  return winners;
}
