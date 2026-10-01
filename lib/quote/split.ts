import type { Cell, ComparedSupplier, QuoteComparisonModel, QuotedRow, RequestedLine } from "./comparison";
import { lineTotalFils } from "./money";

/**
 * Board `1o` — accepting one enquiry's lines from more than one supplier.
 *
 * The rules, as the owner confirmed them on 1 Oct 2026:
 *
 * - **D1** A supplier opts in per quote (`Quote.allowsPartial`). Without it the
 *   quote is all or nothing: it can be accepted whole — beside other suppliers'
 *   lines, too — but never in part. Their prices may assume the whole of it.
 * - **D2** Whole lines only, at the quantity the buyer asked for. One line goes
 *   to one supplier.
 * - **D3** One decision. Every chosen line is accepted in one confirm; a line
 *   left out is not accepted, and the enquiry is decided.
 * - **D7** A line the supplier added — one answering none of the buyer's lines,
 *   such as a delivery charge — goes with any accepted part of their quote.
 *
 * Pure. The comparison model is the input, so the figures a buyer chooses from
 * and the figures a split commits are one computation (`1o` AC1). The service
 * re-reads the quotes under the enquiry's lock and asks this again before it
 * writes anything.
 */

/** Why one cell cannot be taken alone. */
export type CellBlock =
  /** The supplier did not price this line. */
  | "not_quoted"
  /** Priced, but not at the quantity asked (D2). */
  | "other_quantity"
  /** The quote can no longer be accepted: expired, declined, closed, or the supplier closed. */
  | "not_open"
  /** The supplier did not opt in (D1). The quote can still be taken whole. */
  | "all_or_nothing";

export type CellChoice = { ok: true } | { ok: false; reason: CellBlock };

/** One line taken from one supplier, as the buyer chose it. */
export interface SplitPick {
  lineId: string;
  /** The quote the buyer was looking at — its revision is checked again under the lock. */
  quoteId: string;
}

/** What a selection is refused for, before anything is written. */
export type SplitRefusal =
  | "empty"
  /** A line named twice (D2: one line, one supplier). */
  | "line_twice"
  /** A line that is not one of the enquiry's. */
  | "unknown_line"
  /** A quote that is not on this comparison, or not the supplier's current one. */
  | "unknown_quote"
  /** The quote can no longer be accepted. */
  | "not_open"
  /** The supplier did not price that line. */
  | "not_quoted"
  /** Not priced at the quantity asked (D2). */
  | "other_quantity"
  /** Part of a quote whose supplier did not opt in (D1). */
  | "all_or_nothing";

/** One supplier's share of a split: the lines taken, and what they come to. */
export interface SplitPart {
  quoteId: string;
  quoteRef: string;
  supplier: ComparedSupplier;
  /** The buyer's lines taken from this supplier, in the enquiry's order. */
  lineIds: string[];
  /** Every line of theirs that was priced — taking all of them is taking the quote whole. */
  pricedLineIds: string[];
  whole: boolean;
  /** The chosen cells. */
  linesFils: bigint;
  /** Their added lines (D7), which come with any accepted part. */
  extraLines: number;
  extraFils: bigint;
  totalFils: bigint;
  /** The slowest chosen line. Null when none states one. */
  leadTimeDays: number | null;
}

export interface SplitPlan {
  /** In the order of each supplier's first chosen line. */
  parts: SplitPart[];
  /** The buyer's lines no supplier was chosen for — not accepted (D3). */
  unchosenLineIds: string[];
  totalFils: bigint;
  /** Distinct suppliers — derived, never written (`1n` `B3`). */
  deliveries: number;
  /**
   * The supplier with the largest share, first line breaking a tie. The
   * enquiry's decided marker names them; every released supplier is recorded
   * on its own recipient row.
   */
  primaryBusinessId: string;
  /** One supplier, every line they priced: the ordinary accept, not a split (`1o` AC7). */
  single: boolean;
}

export type SplitResult = { ok: true; plan: SplitPlan } | { ok: false; error: SplitRefusal; lineId?: string };

/** Whether one cell may be chosen by itself, and if not, why. */
export function cellChoice(row: QuotedRow, index: number): CellChoice {
  const cell = row.cells[index];
  if (!cell || cell.kind !== "priced") return { ok: false, reason: "not_quoted" };
  if (row.state !== "open") return { ok: false, reason: "not_open" };
  if (!cell.comparable) return { ok: false, reason: "other_quantity" };
  if (!row.quote.allowsPartial) return { ok: false, reason: "all_or_nothing" };
  return { ok: true };
}

/** Whether a quote can be taken whole inside a split: open, and every line it priced at the quantity asked. */
export function wholeChoice(row: QuotedRow): CellChoice {
  if (row.state !== "open") return { ok: false, reason: "not_open" };
  const priced = row.cells.filter((cell): cell is Extract<Cell, { kind: "priced" }> => cell.kind === "priced");
  if (priced.length === 0) return { ok: false, reason: "not_quoted" };
  if (priced.some((cell) => !cell.comparable)) return { ok: false, reason: "other_quantity" };
  return { ok: true };
}

/** Whether this comparison offers a split at all: at least one open quote may be taken in part. */
export function splitOffered(model: QuoteComparisonModel): boolean {
  if (model.phase !== "open") return false;
  return model.rows.some(
    (row) => row.kind === "quoted" && row.quote.allowsPartial && row.cells.some((_, index) => cellChoice(row, index).ok),
  );
}

/**
 * Check a selection against the comparison and plan what accepting it means.
 *
 * Nothing here is a promise: the service builds the comparison again from
 * rows it has locked, and plans again, before it writes.
 */
export function planSplit(model: QuoteComparisonModel, picks: readonly SplitPick[]): SplitResult {
  if (picks.length === 0) return { ok: false, error: "empty" };

  const lineIndex = new Map(model.lines.map((line, index) => [line.id, index]));
  const seen = new Set<string>();
  const byQuote = new Map<string, { row: QuotedRow; indexes: number[] }>();

  for (const pick of picks) {
    const index = lineIndex.get(pick.lineId);
    if (index === undefined) return { ok: false, error: "unknown_line", lineId: pick.lineId };
    if (seen.has(pick.lineId)) return { ok: false, error: "line_twice", lineId: pick.lineId };
    seen.add(pick.lineId);

    const row = model.rows.find((candidate): candidate is QuotedRow => candidate.kind === "quoted" && candidate.quote.id === pick.quoteId);
    if (!row) return { ok: false, error: "unknown_quote", lineId: pick.lineId };
    if (row.state !== "open") return { ok: false, error: "not_open", lineId: pick.lineId };
    const cell = row.cells[index];
    if (!cell || cell.kind !== "priced") return { ok: false, error: "not_quoted", lineId: pick.lineId };
    if (!cell.comparable) return { ok: false, error: "other_quantity", lineId: pick.lineId };

    const entry = byQuote.get(row.quote.id) ?? { row, indexes: [] };
    entry.indexes.push(index);
    byQuote.set(row.quote.id, entry);
  }

  const parts: SplitPart[] = [];
  for (const { row, indexes } of byQuote.values()) {
    const pricedIndexes = row.cells.flatMap((cell, index) => (cell.kind === "priced" ? [index] : []));
    const whole = pricedIndexes.every((index) => indexes.includes(index));
    // D1: a supplier who did not opt in is taken whole or not at all.
    if (!whole && !row.quote.allowsPartial) {
      const first = model.lines[Math.min(...indexes)]!;
      return { ok: false, error: "all_or_nothing", lineId: first.id };
    }
    parts.push(partOf(row, model.lines, indexes.sort((a, b) => a - b), pricedIndexes, whole));
  }
  parts.sort((a, b) => lineIndex.get(a.lineIds[0]!)! - lineIndex.get(b.lineIds[0]!)!);

  const totalFils = parts.reduce((sum, part) => sum + part.totalFils, 0n);
  const primary = [...parts].sort(
    (a, b) => (a.totalFils === b.totalFils ? 0 : a.totalFils > b.totalFils ? -1 : 1) || lineIndex.get(a.lineIds[0]!)! - lineIndex.get(b.lineIds[0]!)!,
  )[0]!;

  return {
    ok: true,
    plan: {
      parts,
      unchosenLineIds: model.lines.filter((line) => !seen.has(line.id)).map((line) => line.id),
      totalFils,
      deliveries: parts.length,
      primaryBusinessId: primary.supplier.businessId,
      single: parts.length === 1 && parts[0]!.whole,
    },
  };
}

function partOf(row: QuotedRow, lines: RequestedLine[], indexes: number[], pricedIndexes: number[], whole: boolean): SplitPart {
  const chosen = indexes.map((index) => row.cells[index] as Extract<Cell, { kind: "priced" }>);
  const known = new Set(lines.map((line) => line.id));
  const extras = row.quote.lines.filter((line) => line.enquiryLineId === null || !known.has(line.enquiryLineId));
  const linesFils = chosen.reduce((sum, cell) => sum + cell.totalFils, 0n);
  const extraFils = extras.reduce((sum, line) => sum + lineTotalFils(line), 0n);
  const stated = chosen.map((cell) => cell.leadTimeDays).filter((days): days is number => days !== null);
  return {
    quoteId: row.quote.id,
    quoteRef: row.quote.ref,
    supplier: row.supplier,
    lineIds: indexes.map((index) => lines[index]!.id),
    pricedLineIds: pricedIndexes.map((index) => lines[index]!.id),
    whole,
    linesFils,
    extraLines: extras.length,
    extraFils,
    totalFils: linesFils + extraFils,
    leadTimeDays: stated.length > 0 ? Math.max(...stated) : null,
  };
}

/**
 * Board `1o` D5 — a request's parts as picks again, against the comparison as it
 * stands: a part's own lines, or for a whole part every line its quote priced.
 * The approver approves what was asked, and `planSplit` checks it once more.
 *
 * Null when a part's quote is no longer on the comparison — revised, or gone.
 */
export function picksFromParts(
  model: QuoteComparisonModel,
  parts: readonly { quoteId: string; enquiryLineIds: readonly string[] | null }[],
): SplitPick[] | null {
  const picks: SplitPick[] = [];
  for (const part of parts) {
    const row = model.rows.find((candidate): candidate is QuotedRow => candidate.kind === "quoted" && candidate.quote.id === part.quoteId);
    if (!row) return null;
    const lineIds =
      part.enquiryLineIds ??
      row.cells.flatMap((cell, index) => (cell.kind === "priced" ? [model.lines[index]!.id] : []));
    for (const lineId of lineIds) picks.push({ lineId, quoteId: part.quoteId });
  }
  return picks;
}

/** The cheapest split that can actually be accepted, and what it leaves out. */
export interface AcceptableSplit {
  plan: SplitPlan;
  picks: SplitPick[];
  /** The best complete single quote, and how far under it this split lands. Null when none is complete. */
  against: { supplier: ComparedSupplier; totalFils: bigint; savingFils: bigint } | null;
  /**
   * Lines where a lower price exists that cannot be taken alone (D1). The
   * card says so rather than leaving the buyer to wonder why the tick and the
   * figure disagree.
   */
  blockedLower: { lineId: string; businessId: string }[];
}

/**
 * Board `1o`'s card: the cheapest way to cover every line that the rules allow.
 *
 * A supplier who opted in offers each comparable cell alone; one who did not
 * offers their whole quote or nothing. Every combination of whole quotes is
 * tried — eight suppliers at most, so 256 — and the remaining lines go to the
 * cheapest cell that may be taken alone. Ties go to fewer deliveries, then to
 * the order `1n` marks winners in.
 *
 * Null when no split covers every line, when the cheapest cover is a single
 * supplier's whole quote, or when it is no cheaper than the best complete
 * single quote.
 */
export function cheapestAcceptableSplit(model: QuoteComparisonModel): AcceptableSplit | null {
  if (model.phase !== "open" || model.lines.length === 0) return null;
  const rows = model.rows.filter((row): row is QuotedRow => row.kind === "quoted" && row.state === "open");
  if (rows.length < 2) return null;

  const wholes = rows.filter((row) => !row.quote.allowsPartial && wholeChoice(row).ok);
  let best: { picks: SplitPick[]; plan: SplitPlan } | null = null;

  for (let mask = 0; mask < 1 << wholes.length; mask += 1) {
    const taken = wholes.filter((_, bit) => mask & (1 << bit));
    const covered = new Map<number, QuotedRow>();
    let clash = false;
    for (const row of taken) {
      row.cells.forEach((cell, index) => {
        if (cell.kind !== "priced") return;
        if (covered.has(index)) clash = true;
        covered.set(index, row);
      });
    }
    if (clash) continue;

    const picks: SplitPick[] = [];
    let complete = true;
    for (const [index, line] of model.lines.entries()) {
      const whole = covered.get(index);
      if (whole) {
        picks.push({ lineId: line.id, quoteId: whole.quote.id });
        continue;
      }
      const cheapest = cheapestAlone(rows, index);
      if (!cheapest) {
        complete = false;
        break;
      }
      picks.push({ lineId: line.id, quoteId: cheapest.quote.id });
    }
    if (!complete) continue;

    const planned = planSplit(model, picks);
    if (!planned.ok) continue;
    if (!best || cheaper(planned.plan, best.plan)) best = { picks, plan: planned.plan };
  }

  if (!best || best.plan.deliveries < 2) return null;

  const single = rows
    .filter((row) => row.comparable)
    .reduce<QuotedRow | null>((winner, row) => (!winner || row.totalFils < winner.totalFils ? row : winner), null);
  const against = single
    ? { supplier: single.supplier, totalFils: single.totalFils, savingFils: single.totalFils - best.plan.totalFils }
    : null;
  if (against && against.savingFils <= 0n) return null;

  const blockedLower: AcceptableSplit["blockedLower"] = [];
  for (const [index, line] of model.lines.entries()) {
    const chosen = best.plan.parts.find((part) => part.lineIds.includes(line.id))!;
    const chosenCell = rows.find((row) => row.quote.id === chosen.quoteId)!.cells[index] as Extract<Cell, { kind: "priced" }>;
    for (const row of rows) {
      const cell = row.cells[index];
      if (row.quote.id === chosen.quoteId || !cell || cell.kind !== "priced" || !cell.comparable) continue;
      const choice = cellChoice(row, index);
      if (cell.totalFils < chosenCell.totalFils && !choice.ok && choice.reason === "all_or_nothing") {
        blockedLower.push({ lineId: line.id, businessId: row.supplier.businessId });
      }
    }
  }

  return { plan: best.plan, picks: best.picks, against, blockedLower };
}

/** The cheapest cell in a column that may be taken alone, with `1n`'s tie-breaks. */
function cheapestAlone(rows: QuotedRow[], index: number): QuotedRow | null {
  let best: QuotedRow | null = null;
  for (const row of rows) {
    if (!cellChoice(row, index).ok) continue;
    if (!best) {
      best = row;
      continue;
    }
    const cell = row.cells[index] as Extract<Cell, { kind: "priced" }>;
    const bestCell = best.cells[index] as Extract<Cell, { kind: "priced" }>;
    if (cell.totalFils !== bestCell.totalFils) {
      if (cell.totalFils < bestCell.totalFils) best = row;
      continue;
    }
    const lead = compareLead(cell.leadTimeDays, bestCell.leadTimeDays);
    if (lead !== 0) {
      if (lead < 0) best = row;
      continue;
    }
    const sent = row.quote.sentAt.getTime() - best.quote.sentAt.getTime();
    if (sent !== 0) {
      if (sent < 0) best = row;
      continue;
    }
    if (row.supplier.businessId < best.supplier.businessId) best = row;
  }
  return best;
}

function cheaper(a: SplitPlan, b: SplitPlan): boolean {
  if (a.totalFils !== b.totalFils) return a.totalFils < b.totalFils;
  return a.deliveries < b.deliveries;
}

function compareLead(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}
