/**
 * What a seller may call themselves. Board 2c, and the place the split between
 * a legal name and a display name is actually created.
 *
 * `tradeName` is locked to the licence and appears only where the licence record
 * is the subject. `displayName` is the seller's own choice and appears
 * everywhere a seller is *presented* — storefront heading, search rows, cards,
 * recipient lists, review headers, comparison rows. This module is the gate
 * between the two.
 *
 * Three rules, and the third deliberately does not refuse:
 *
 *   1. **No legal suffix.** `Gulf Cool Technical Services LLC` is the registry's
 *      name for the entity; `Gulf Cool Technical` is what a buyer calls them.
 *      Carrying the suffix onto a card is how a directory ends up looking like a
 *      registry export, which is what buyers already have and do not want.
 *   2. **No category word already on the chips.** "Gulf Cool HVAC Services"
 *      under a primary category of HVAC says HVAC twice on one card, in the two
 *      places a buyer reads first.
 *   3. **A near-match to a verified listing in the same emirate is *accepted*
 *      and flagged.** It is usually a coincidence in a market where a hundred
 *      firms are called Al Something Trading, and occasionally it is somebody
 *      trying to be mistaken for a competitor. A form cannot tell those apart,
 *      and refusing inline would block the common case to catch the rare one.
 *      That decision belongs to a person, so it goes to the queue.
 *
 * Pure. The collision check needs the database and lives in `./profile.ts`; what
 * is here is the comparison it runs.
 */

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 60;

/**
 * The suffixes a UAE trade licence ends with.
 *
 * Matched as whole words at the end of the name, or anywhere for the punctuated
 * forms. `Est.` is deliberately last and narrowest: "Est" appears inside
 * ordinary words and "Established 1998" is a sentence a seller might reasonably
 * write.
 */
const SUFFIXES: readonly RegExp[] = [
  /\bL\.?L\.?C\.?\b/i,
  /\bF\.?Z\.?E\.?\b/i,
  /\bF\.?Z\.?C\.?O\.?\b/i,
  /\bFZ[\s-]?LLC\b/i,
  /\bD\.?M\.?C\.?C\.?\b/i,
  /\bW\.?L\.?L\.?\b/i,
  /\bS\.?P\.?C\.?\b/i,
  /\bP\.?J\.?S\.?C\.?\b/i,
  /\bTrading\s+Co\.?\b/i,
  /\bEst\.\B|\bEst\.$/i,
  /\bSole\s+Proprietorship\b/i,
  /\bBranch\s+of\b/i,
];

export type DisplayNameProblem =
  | { kind: "too_short" }
  | { kind: "too_long"; length: number }
  | { kind: "legal_suffix"; found: string }
  | { kind: "repeats_category"; word: string };

export type DisplayNameCheck =
  | { ok: true; value: string }
  | { ok: false; problem: DisplayNameProblem };

/**
 * @param categoryWords the names of the categories this listing carries, so the
 *   check can catch a name that repeats one. Pass them raw — splitting and
 *   filtering happens here.
 */
export function checkDisplayName(
  input: string,
  categoryWords: readonly string[] = [],
): DisplayNameCheck {
  const value = input.trim().replace(/\s+/g, " ");

  if (value.length < DISPLAY_NAME_MIN) return { ok: false, problem: { kind: "too_short" } };
  if (value.length > DISPLAY_NAME_MAX) {
    return { ok: false, problem: { kind: "too_long", length: value.length } };
  }

  for (const pattern of SUFFIXES) {
    const found = pattern.exec(value);
    if (found) return { ok: false, problem: { kind: "legal_suffix", found: found[0] } };
  }

  const repeated = repeatedCategoryWord(value, categoryWords);
  if (repeated) return { ok: false, problem: { kind: "repeats_category", word: repeated } };

  return { ok: true, value };
}

/**
 * A significant word the name and a category both carry.
 *
 * Words shorter than four letters are ignored, and so are the joining words a
 * category name is full of: "Valves & fittings" would otherwise object to a
 * business called "and". An acronym is the exception worth keeping — HVAC, PPE,
 * AMC are four and three letters and are exactly the repetition this is for.
 */
const IGNORED = new Set([
  "and", "the", "for", "with", "services", "service", "trading", "general",
  "company", "group", "supplies", "supply", "equipment", "materials", "systems",
]);

function repeatedCategoryWord(name: string, categoryWords: readonly string[]): string | null {
  const inName = new Set(words(name));
  for (const category of categoryWords) {
    for (const word of words(category)) {
      if (IGNORED.has(word)) continue;
      const isAcronym = word.length === 3 && /^[a-z]+$/.test(word);
      if (word.length < 4 && !isAcronym) continue;
      if (inName.has(word)) return word;
    }
  }
  return null;
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Two names close enough that a buyer could mistake one for the other.
 *
 * A substring match on the normalised forms, per the board. Not a fuzzy score:
 * this feeds a queue a person reads, and the useful signal is "one of these
 * contains the other", which a reviewer can check in a second. Anything cleverer
 * would put more rows in front of them for no better reason.
 */
export function couldBeMistakenFor(candidate: string, existing: string): boolean {
  const a = normalise(candidate);
  const b = normalise(existing);
  if (!a || !b) return false;
  // Below this almost anything contains almost anything.
  if (a.length < 5 || b.length < 5) return a === b;
  return a.includes(b) || b.includes(a);
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
