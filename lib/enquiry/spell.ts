/**
 * A count as an English word, for board 1i's `h1`.
 *
 * "Number spelled as a word in the `h1`, digits everywhere else" — the spec
 * says so, and §08 agrees: an `h1` is read as a sentence and "2 suppliers have
 * quoted." reads like a spreadsheet.
 *
 * Only to eight, because the fan-out cap is eight and nothing here can exceed
 * it. Anything larger falls back to digits rather than inventing a rule the
 * product does not need.
 */
const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
] as const;

export function spell(count: number): string {
  return WORDS[count] ?? String(count);
}

/** The same, capitalised, for a sentence that starts with it. */
export function spellCapitalised(count: number): string {
  const word = spell(count);
  return word.charAt(0).toUpperCase() + word.slice(1);
}
