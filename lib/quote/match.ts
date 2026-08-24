import { canonicalSize, sameNominalSize } from "@/lib/trade/nominal-size";

/**
 * Match an enquiry line to something in the seller's own catalogue.
 *
 * The README asks for "lines matched to catalogue SKUs with stock shown,
 * unmatched lines flagged for manual pricing and never silently blank". The
 * second half is the hard half. A matcher that always finds something is worse
 * than no matcher: the seller stops reading the suggestions, and one day sends
 * a DN600 line at the DN100 price with their name on it.
 *
 * So this errs towards `unmatched`. Everything it does is explainable in the
 * UI — each match carries the reasons it was made, and the seller can override
 * any of it.
 *
 * Pure: no database, no Prisma types. The query layer fetches, this decides.
 */

export interface MatchableProduct {
  id: string;
  name: string;
  sku: string | null;
  /** The denormalised match surface, already lowercased by the writer. */
  searchText: string;
  /** The nominal size as the seller stored it, if the category has one. */
  size: string | null;
  availability: string;
  stockQty: number | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
}

export interface MatchableLine {
  description: string;
  /** Free text as the buyer wrote it: `DN100`, `4"`, or nothing. */
  size: string | null;
}

/** Why the matcher believes this. Rendered to the seller, not just logged. */
export type MatchReason = "sku" | "size" | "wording";

export interface ProductMatch {
  product: MatchableProduct;
  /** 0..1. Comparable within one line only. */
  score: number;
  reasons: readonly MatchReason[];
}

export interface LineMatch {
  /** Null means: price this by hand. Never a low-confidence guess. */
  best: ProductMatch | null;
  /** Runners-up worth offering in a picker. Best-first, best excluded. */
  alternatives: readonly ProductMatch[];
}

/**
 * The floor a match must clear to be offered as the answer rather than as a
 * suggestion. Set by hand against the seeded catalogue: "Resilient seated gate
 * valve, flanged / DN100" clears it comfortably, "API 6D trunnion ball valve /
 * DN600" clears nothing at all.
 */
export const MATCH_FLOOR = 0.45;

/** Below this a candidate is not even worth showing in the picker. */
const ALTERNATIVE_FLOOR = 0.2;

const MAX_ALTERNATIVES = 4;

/**
 * Words that appear in most lines in a category and so distinguish nothing.
 * Kept short on purpose — an over-eager stop list is how "check valve" becomes
 * "valve" and matches everything on the shelf.
 */
const NOISE = new Set([
  "and", "for", "the", "with", "of", "to", "in", "on", "a", "an", "as", "at", "by", "or", "off",
  "pcs", "pc", "nos", "no", "qty", "each", "set", "sets", "unit", "units",
  "approx", "approximately", "please", "required", "req", "supply", "supplied",
]);

/** A digit run, optionally a fraction, optionally an inch mark. `4`, `4"`, `1/2"`. */
const SHORT_BUT_MEANINGFUL = /^\d+(?:\/\d+)?"?$/;

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    // Keep the inch mark: 4" is a token, not a 4 and a stray quote.
    .replace(/[″”“']/g, '"')
    .split(/[^a-z0-9"/.-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    // Two characters is not a word that distinguishes two valves. Numbers and
    // imperial sizes are the exception: `24`, `100` and `4"` are short and are
    // very often the only distinguishing part of the line.
    .filter((w) => (w.length > 2 || SHORT_BUT_MEANINGFUL.test(w)) && !NOISE.has(w));
}

/**
 * Score one candidate against one line.
 *
 * Returns null where the pair is vetoed outright rather than merely scoring
 * badly — the caller must not be able to accept a veto by lowering a threshold.
 */
function scoreCandidate(line: MatchableLine, product: MatchableProduct): ProductMatch | null {
  const lineSize = canonicalSize(line.size);
  const productSize = canonicalSize(product.size);

  /*
   * The veto. If both sides name a readable bore and the bores differ, this is
   * a different product however similar the words are. "Gate valve DN100" and
   * "Gate valve DN150" share every word that matters and are not substitutes.
   */
  if (lineSize && productSize && lineSize !== productSize) return null;

  const reasons: MatchReason[] = [];
  const lineTokens = tokenise(line.description);

  // An exact SKU in the line's text is the seller's own code coming back at
  // them. Nothing else needs to agree.
  if (product.sku) {
    const sku = product.sku.toLowerCase();
    if (lineTokens.includes(sku)) {
      return { product, score: 1, reasons: ["sku"] };
    }
  }

  /*
   * Whole tokens only. The search surface is a space-joined token list, so a
   * substring test is never needed and is actively wrong: `as` is inside
   * `cast`, and that alone once scored a Y-strainer as a perfect match.
   */
  const haystack = ` ${product.searchText.toLowerCase()} ${product.name.toLowerCase()} `;
  const hits = lineTokens.filter((tok) => haystack.includes(` ${tok} `));
  const wording = lineTokens.length === 0 ? 0 : hits.length / lineTokens.length;
  const sizeAgrees = Boolean(lineSize && productSize && sameNominalSize(line.size, product.size));

  /*
   * Evidence, not ratio. One word out of one is a ratio of 1 and tells you
   * nothing — "valve" against a valve catalogue is not a match. A match needs
   * either an agreeing bore plus some wording, or two distinct words that
   * landed.
   */
  const enoughEvidence = (sizeAgrees && hits.length >= 1) || hits.length >= 2;
  if (!enoughEvidence) return { product, score: 0, reasons: [] };

  if (wording > 0) reasons.push("wording");

  let score = wording * 0.7;
  if (sizeAgrees) {
    score += 0.3;
    reasons.push("size");
  } else if (!lineSize && !productSize) {
    // Neither side is sized. Wording carries the whole decision, so let it.
    score = wording;
  }

  return { product, score: Math.min(1, score), reasons };
}

export function matchLine(
  line: MatchableLine,
  catalogue: readonly MatchableProduct[],
): LineMatch {
  const scored = catalogue
    .map((p) => scoreCandidate(line, p))
    .filter((m): m is ProductMatch => m !== null)
    .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));

  const top = scored[0];
  const best = top && top.score >= MATCH_FLOOR ? top : null;

  const alternatives = scored
    .filter((m) => m !== best && m.score >= ALTERNATIVE_FLOOR)
    .slice(0, MAX_ALTERNATIVES);

  return { best, alternatives };
}

export function matchLines(
  lines: readonly MatchableLine[],
  catalogue: readonly MatchableProduct[],
): LineMatch[] {
  return lines.map((line) => matchLine(line, catalogue));
}
