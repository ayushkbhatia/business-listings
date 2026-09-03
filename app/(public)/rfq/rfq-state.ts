/**
 * Board 1h's three steps, as a derivation rather than a place you navigate to.
 *
 * The composer model is explicit three times over: "the stepper reflects
 * completion, not navigation", "all three steps live on one route and the page
 * never reloads", and "steps never gate backwards". So a step is not state — it
 * is a reading of the state, and there is nothing to set.
 *
 * That last rule is what this shape buys. A buyer at step 3 who goes back and
 * edits a line stays at step 3, because `send` still holds; with a stored step
 * they would have been dragged backwards by their own correction.
 */

export interface RfqLine {
  key: string;
  description: string;
  qty: number;
  targetUnitPriceAed: string;
  /** Set when the line came from a catalogue. Null for free text. */
  productId: string | null;
  sku: string | null;
  sellerName: string | null;
}

export interface RfqState {
  lines: readonly RfqLine[];
  emirate: string;
  area: string;
  picked: readonly string[];
}

/** 1, 2 or 3 — the furthest step the current state satisfies. */
export function stepOf(state: RfqState): 1 | 2 | 3 {
  if (!hasLine(state.lines)) return 1;
  if (!state.emirate || state.picked.length === 0) return 2;
  return 3;
}

/**
 * A line counts once it says something.
 *
 * A blank row is the cursor waiting, not an item — step 1's table renders one
 * and the buyer has not typed yet. Trimmed, so a space bar does not advance the
 * page.
 */
export function hasLine(lines: readonly RfqLine[]): boolean {
  return lines.some((line) => line.description.trim().length > 0);
}

/** The lines that would actually be sent. */
export function filledLines(lines: readonly RfqLine[]): RfqLine[] {
  return lines.filter((line) => line.description.trim().length > 0);
}

/**
 * Why Send is off, in a sentence, or null when it is on.
 *
 * Never a silent dead button — the spec says so for the zero-recipient case and
 * it is the right rule for all of them. A disabled control with no reason is a
 * puzzle the buyer solves by leaving.
 */
export function sendBlockedBy(
  state: RfqState,
  labels: { noLines: string; noArea: string; noRecipients: string },
): string | null {
  if (!hasLine(state.lines)) return labels.noLines;
  if (!state.emirate) return labels.noArea;
  if (state.picked.length === 0) return labels.noRecipients;
  return null;
}

export const MAX_LINES = 20;
