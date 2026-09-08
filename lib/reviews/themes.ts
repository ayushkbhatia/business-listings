/**
 * What several reviews agree on. Board 11c `B3`.
 *
 * The board wrote *"Two reviews mention brand substitution. That is a process
 * fix, not a review problem"* under the dimension scores, and nothing in the
 * product did anything with review text. The note is explicit that it does not
 * get softened into a hedge — the same rule `3l` applied to the cover-photo
 * diagnosis — so this is the claim, built.
 *
 * ## Why a lexicon and not a model
 *
 * The page's entire argument is that its numbers are true, and it is read by a
 * supplier deciding whether to change how their counter works. A sentence
 * produced by a language model is not reproducible, cannot be shown its
 * working, and would be a per-render cost on a dashboard. What a seller needs
 * from this panel is *"these two reviews said this"* with the two reviews
 * attached, which is a lookup with evidence rather than a summary.
 *
 * So: a fixed vocabulary of operational complaints, matched over the review
 * bodies in the window, counted by review. Deterministic, testable without a
 * database, and every count on screen is a set of rows a seller can open.
 *
 * ## The phrases are complaints, not mentions
 *
 * This is where the honesty lives, and it is the failure `3l`'s demand-gap
 * matcher already produced once: a naive keyword list would tell a seller that
 * *"three reviews mention delivery"* when all three were praising it. So the
 * lexicon carries `delivered late` and `still waiting` and does not carry
 * `delivery`; it carries `out of stock` and does not carry `in stock`. A theme
 * fires on the shape of a complaint or it does not fire.
 *
 * Negation is the remaining hole and it is closed below: *"nothing was damaged"*
 * is not a damage report, and a panel that read it as one would be worse than
 * having no panel.
 *
 * Pure. The caller fetches the reviews; this reads their words.
 */

import type { Dimension } from "./eligibility";

/**
 * Below this a theme is one person's account, not a pattern.
 *
 * Two, from the board's own sentence. A panel that told a supplier to change a
 * process on the strength of a single review would be the padding rule in a
 * different costume — a section filled because there was space for it.
 */
export const MIN_THEME_REVIEWS = 2;

/** The rail has room for a couple of sentences, not a report. */
export const MAX_THEMES = 3;

export const THEME_KEYS = [
  "brand_substitution",
  "stock_accuracy",
  "late_delivery",
  "short_delivery",
  "wrong_item",
  "paperwork_missing",
  "damaged_on_arrival",
  "slow_to_reply",
  "price_changed",
] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];

interface ThemeSpec {
  /**
   * The dimension this theme sits under.
   *
   * So the panel can put the sentence beside the score it explains rather than
   * floating it under all four: "As described · 4.4" with "two reviews mention
   * brand substitution" beneath it is a diagnosis; the same sentence under the
   * whole block is trivia.
   */
  dimension: Dimension;
  /**
   * Phrases, each already complaint-shaped.
   *
   * A trailing `*` matches a word by its stem — `substitut*` covers substitute,
   * substituted and substitution, which is the whole of the stemming this needs
   * and is legible in a way a stemmer's output is not.
   */
  phrases: readonly string[];
}

/**
 * The vocabulary. Nine themes, each an operational fact a supplier can act on.
 *
 * Deliberately not sentiment. "Rude on the phone" is a complaint and there is
 * nothing to fix in a process; "short delivered" is a complaint with a picking
 * procedure behind it. The board's own framing sets the bar — *"that is a
 * process fix, not a review problem"* — and a theme that is not a process fix
 * does not earn a line on this rail.
 */
const THEMES: Record<ThemeKey, ThemeSpec> = {
  brand_substitution: {
    dimension: "asDescribed",
    phrases: [
      "substitut*",
      "different brand",
      "another brand",
      "alternative brand",
      "equivalent brand",
      "brand swap",
      "swapped the brand",
      "changed the brand",
      "not the brand",
    ],
  },
  stock_accuracy: {
    dimension: "asDescribed",
    phrases: [
      "out of stock",
      "not in stock",
      "no stock",
      "stock was wrong",
      "showing in stock",
      "shown in stock",
      "told was in stock",
      "said was in stock",
    ],
  },
  late_delivery: {
    dimension: "onTime",
    phrases: [
      "delivered late",
      "arrived late",
      "was late",
      "were late",
      "delay*",
      "took longer",
      "behind schedule",
      "missed the date",
      "still waiting",
      "did not arrive",
      "never arrived",
    ],
  },
  short_delivery: {
    dimension: "asDescribed",
    phrases: [
      "short deliver*",
      "shortage",
      "pieces short",
      "missing pieces",
      "missing items",
      "wrong quantity",
      "quantity was wrong",
      "part of the order",
    ],
  },
  wrong_item: {
    dimension: "asDescribed",
    phrases: [
      "wrong size",
      "wrong item",
      "wrong part",
      "wrong spec",
      "wrong model",
      "wrong material",
      "incorrect part",
      "not what we asked",
      "not what i asked",
    ],
  },
  paperwork_missing: {
    dimension: "asDescribed",
    phrases: [
      "no certificate",
      "missing certificate",
      "certificate was missing",
      "without certificate",
      "no test certificate",
      "no mill certificate",
      "no datasheet",
      "no warranty",
      "paperwork was missing",
    ],
  },
  damaged_on_arrival: {
    dimension: "asDescribed",
    phrases: [
      "damaged",
      "dented",
      "rusted",
      "scratched",
      "badly packed",
      "poor packaging",
      "packaging was",
    ],
  },
  slow_to_reply: {
    dimension: "responsiveness",
    phrases: [
      "no reply",
      "did not reply",
      "never replied",
      "no response",
      "had to chase",
      "chased them",
      "chasing",
      "slow to respond",
      "never got back",
      "unanswered",
    ],
  },
  price_changed: {
    dimension: "quotedAccurate",
    phrases: [
      "price changed",
      "price went up",
      "charged more",
      "different price",
      "extra charge",
      "hidden charge",
      "more than quoted",
      "above the quote",
      "additional cost",
    ],
  },
};

/**
 * Words that turn a complaint into its opposite.
 *
 * *"Nothing was damaged"*, *"no delay at all"*, *"never had to chase"* — each
 * would fire a theme on a straight substring match, and each is praise. This is
 * the one piece of grammar the matcher does, and it earns its place: a rail
 * telling a supplier to fix a process because three reviews said nothing broke
 * would be worse than having no rail.
 */
const NEGATIONS = new Set(["no", "not", "never", "nothing", "none", "without", "zero"]);

/**
 * Words a negation is allowed to reach across.
 *
 * "Nothing **was** damaged" puts a copula between the negation and the word it
 * negates, so looking one word back finds `was` and misses it. Looking three
 * words back unconditionally is the other error — it would kill *"no
 * certificate, and the crate arrived damaged"*, which is two complaints.
 *
 * So the walk skips only words that carry no meaning of their own and stops at
 * the first that does. Two hops is as far as this construction reaches in
 * English, and further would be guessing.
 */
const CARRIES_NOTHING = new Set(["was", "were", "is", "are", "be", "been", "being", "any", "at"]);

const NEGATION_REACH = 2;

/** Is the word before this match — across a copula — a negation? */
function negated(haystack: readonly string[], index: number): boolean {
  let back = index - 1;
  for (let steps = 0; back >= 0 && steps <= NEGATION_REACH; steps += 1, back -= 1) {
    const word = haystack[back]!;
    if (NEGATIONS.has(word)) return true;
    if (!CARRIES_NOTHING.has(word)) return false;
  }
  return false;
}

/**
 * Review text as words, lowercase, punctuation gone.
 *
 * `'` collapses rather than splits so "didn't" becomes "didnt" and not "didn t"
 * — the second would put a bare `t` between a negation and the word it negates.
 */
export function words(body: string): string[] {
  return body
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Does this word satisfy the phrase token — exactly, or by stem? */
function tokenMatches(token: string, word: string): boolean {
  return token.endsWith("*") ? word.startsWith(token.slice(0, -1)) : word === token;
}

/**
 * Is this phrase in this review, un-negated?
 *
 * Exported for the test, which is the only way to assert the negation rule
 * without asserting it through nine themes at once.
 */
export function mentions(body: string, phrase: string): boolean {
  const haystack = words(body);
  const needle = phrase.split(" ");

  for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    const hit = needle.every((token, offset) => tokenMatches(token, haystack[index + offset]!));
    if (!hit) continue;
    if (negated(haystack, index)) continue;
    return true;
  }
  return false;
}

export interface ThemeFinding {
  key: ThemeKey;
  dimension: Dimension;
  /** How many reviews carry it. Never below `MIN_THEME_REVIEWS`. */
  count: number;
  /** Which ones, so the panel's number is a set a seller can open. */
  reviewIds: string[];
}

/**
 * The themes several reviews agree on, strongest first.
 *
 * One review counts once for a theme however many of its phrases it uses:
 * a review that says "substituted" and "different brand" in two sentences is
 * one person's account of one incident, and counting it twice is exactly how a
 * panel comes to claim more agreement than it has.
 */
export function themesIn(
  reviews: readonly { id: string; body: string }[],
  minimum: number = MIN_THEME_REVIEWS,
): ThemeFinding[] {
  const findings: ThemeFinding[] = [];

  for (const key of THEME_KEYS) {
    const spec = THEMES[key];
    const reviewIds = reviews
      .filter((review) => spec.phrases.some((phrase) => mentions(review.body, phrase)))
      .map((review) => review.id);

    if (reviewIds.length >= minimum) {
      findings.push({ key, dimension: spec.dimension, count: reviewIds.length, reviewIds });
    }
  }

  return findings
    .sort((a, b) => b.count - a.count || THEME_KEYS.indexOf(a.key) - THEME_KEYS.indexOf(b.key))
    .slice(0, MAX_THEMES);
}
