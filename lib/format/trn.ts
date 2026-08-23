import { MASK_CHAR } from "./locale";

/** A UAE Tax Registration Number is fifteen digits. */
const TRN_LENGTH = 15;

export function normaliseTRN(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return digits.length === TRN_LENGTH ? digits : null;
}

export function isValidTRN(input: string): boolean {
  return normaliseTRN(input) !== null;
}

/** `100 1234 5678 3003`. The seller's own view, and a tax invoice. */
export function formatTRN(input: string): string {
  const d = normaliseTRN(input);
  if (!d) return input.trim();
  return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7, 11)} ${d.slice(11)}`;
}

/**
 * `100 •••• •••• 3003` — first three, last four.
 *
 * Enough for a buyer's finance team to match a TRN they already hold against the
 * listing, and not enough to copy one onto a fake invoice. Grouping matches
 * formatTRN so the masked and revealed forms sit at the same width in a table.
 */
export function maskTRN(input: string): string {
  const d = normaliseTRN(input);
  if (!d) return MASK_CHAR.repeat(4);
  const head = d.slice(0, 3);
  const tail = d.slice(-4);
  return `${head} ${MASK_CHAR.repeat(4)} ${MASK_CHAR.repeat(4)} ${tail}`;
}
