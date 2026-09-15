/**
 * The vocabulary rules from CLAUDE.md, for copy that never reaches the CI scan.
 *
 * `pnpm check:vocabulary` reads `lib/i18n/en.ts`, the JSX and the seeds. A half
 * written from `/admin/strings/paired` lives in a database row, where no scan
 * can see it — board `12g-s` Q1, and the argument `6g` was built on before it
 * was cut. So the save runs the same rules on the words before they are
 * accepted. It finds a banned word, never a wrong meaning; the pairing count
 * finds a missing twin, never a wrong one. Neither is a copy review.
 *
 * The patterns are the script's, character for character, and
 * `vocabulary.test.ts` reads `scripts/check-vocabulary.sh` to hold them equal.
 * A rule added to one and not the other fails that test.
 */

export type VocabularyRule = "banned" | "order" | "legal_suffix" | "provenance" | "site_visit";

/** Rule 1 — words for things that do not exist. */
export const BANNED =
  "\\b(cart|basket|checkout|purchase|payout|refund|dispatch|GMV|POD)\\b" +
  "|price on request|price: low to high|download price list" +
  "|get quote\\b|get a quote|add to cart";

/** Rule 2 — "order" in its commerce sense. */
export const ORDER =
  "\\b(your|my) orders?\\b" +
  "|\\border (total|history|number|id|status|summary|details|confirmation)\\b" +
  "|\\b(place|track|cancel|repeat|reorder) (an? )?order\\b" +
  "|\\borders? (placed|shipped|delivered|confirmed)\\b";

/** Rule 3 — legal suffixes. Seller identity is `displayName`, from the database. Case-sensitive, as in the script. */
export const LEGAL_SUFFIX = "\\b(LLC|L\\.L\\.C|FZE|FZCO|FZ-LLC|Trading Co\\.)\\b";

/** Rule 5 — provenance labels for things that were never bought. */
export const PROVENANCE = "verified (purchase|buyer|customer|order)";

/** Rule 6 — the site visit, withdrawn on 5 Sep 2026. */
export const SITE_VISIT =
  "\\bsite[- ]visit|\\bvisited\\b|verification (site )?visit|premises (have been |been )?visit|\\bfield team\\b|stood in the building|been to the (premises|warehouse|factory|office)|seen the stock|\\bin person at (their|the)\\b|walked the (floor|warehouse)";

const RULES: readonly { rule: VocabularyRule; pattern: RegExp }[] = [
  { rule: "banned", pattern: new RegExp(BANNED, "i") },
  { rule: "order", pattern: new RegExp(ORDER, "i") },
  { rule: "legal_suffix", pattern: new RegExp(LEGAL_SUFFIX) },
  { rule: "provenance", pattern: new RegExp(PROVENANCE, "i") },
  { rule: "site_visit", pattern: new RegExp(SITE_VISIT, "i") },
];

export interface VocabularyProblem {
  rule: VocabularyRule;
  /** The words that matched, as written. */
  match: string;
}

/** Every rule the text breaks, in rule order, with what matched. */
export function vocabularyProblems(text: string): VocabularyProblem[] {
  const problems: VocabularyProblem[] = [];
  for (const { rule, pattern } of RULES) {
    const found = pattern.exec(text);
    if (found) problems.push({ rule, match: found[0] });
  }
  return problems;
}
