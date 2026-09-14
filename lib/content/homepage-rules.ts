import { parseSearchQuery, toSearchParams } from "../search/query";
import { EXPIRED_LICENCE_TIER, VERIFIED_TIER } from "../verification";

/**
 * Board 6h — the rules both halves of homepage curation read.
 *
 * Pure, so the console, the directory home and the tests all ask one function
 * the same question. The home page asking "may this card render?" and the
 * console asking "why is this slot empty?" must never get two answers, and the
 * way they drift apart is each keeping its own copy of the condition.
 */

/**
 * The headline and search prompt — the first rail in board 6h's map. Strings,
 * not curation: the page reads them through these keys, and the map counts the
 * keys rather than stating how many there are.
 */
export const HOME_HEADLINE = { title: "home.hero_title", prompt: "home.search_what_placeholder" } as const;

/** Four cards: the four on `1a`. */
export const SLOT_COUNT = 4;
export const SLOT_POSITIONS = [1, 2, 3, 4] as const;

/** Six chips (`Q2`). The hero row does not take a seventh. */
export const CHIP_CAP = 6;
export const CHIP_LABEL_MIN = 2;
export const CHIP_LABEL_MAX = 40;
export const CHIP_QUERY_MAX = 500;

// ── Eligibility (B1) ──────────────────────────────────────────────────────────

/**
 * Why a business cannot hold a card, most decisive first.
 *
 * One condition is the rule — **Tier 2 · Licence verified** — and the rest are
 * the reasons a Tier 2 business is not in the directory at all. Each is a
 * sentence on the console that names what failed, because a blocked row that
 * names the condition is a work item and one reading NOT ELIGIBLE is a dead end.
 *
 * Plan tier and payment appear nowhere in this type (`B4`).
 */
export type FeatureBlock =
  | "merged"
  | "closed"
  | "suspended"
  | "unpublished"
  | "licence_lapsed"
  | "licence_unchecked"
  | "not_verified";

export interface FeatureFacts {
  verificationTier: number;
  licenceExpiry: Date;
  suspendedAt: Date | null;
  publishedAt: Date | null;
  mergedIntoId: string | null;
  closureRequestedAt: Date | null;
  closedAt: Date | null;
}

/**
 * Null when the business may hold a card right now.
 *
 * Read live, every render. A licence past its date with the tier still at 2 is
 * still eligible: the tier is the claim, and the rail follows the nightly sweep
 * that drops it rather than second-guessing it with a clock of its own — which
 * is what the spec means by "out of the rail on the next expiry pass". A
 * suspension has no pass to wait for; it is a decision, and the card goes the
 * moment the row says so.
 */
export function featureBlock(facts: FeatureFacts, now: Date = new Date()): FeatureBlock | null {
  if (facts.mergedIntoId) return "merged";
  if (facts.closedAt || facts.closureRequestedAt) return "closed";
  if (facts.suspendedAt) return "suspended";
  if (!facts.publishedAt) return "unpublished";
  if (facts.verificationTier >= VERIFIED_TIER) return null;
  // At the floor an expiry puts a listing on, with the date behind it: the sweep did this.
  if (facts.verificationTier === EXPIRED_LICENCE_TIER && facts.licenceExpiry.getTime() < now.getTime()) {
    return "licence_lapsed";
  }
  return facts.verificationTier >= 1 ? "licence_unchecked" : "not_verified";
}

/** Whether the console should offer the verification record as the next step. */
export function blockIsVerification(block: FeatureBlock): boolean {
  return block === "licence_lapsed" || block === "licence_unchecked" || block === "not_verified";
}

// ── Slots ─────────────────────────────────────────────────────────────────────

export interface HeldSlot {
  position: number;
  businessId: string;
}

/** Four entries, position order; null where nobody holds the slot. */
export function slotOrder(held: readonly HeldSlot[]): (string | null)[] {
  return SLOT_POSITIONS.map((position) => held.find((slot) => slot.position === position)?.businessId ?? null);
}

/**
 * The first slot nobody holds.
 *
 * A slot held by a business that has since lost eligibility is *held*. It
 * renders empty on the home page, and it stays taken here until a person
 * removes it — no automatic backfill (`B2`).
 */
export function firstFreePosition(held: readonly HeldSlot[]): number | null {
  return SLOT_POSITIONS.find((position) => !held.some((slot) => slot.position === position)) ?? null;
}

export type OrderProblem = "wrong_length" | "duplicate" | "different_members";

/**
 * A proposed order is the same businesses in different places.
 *
 * Reordering never adds or removes anybody — those are their own audited acts
 * with their own reasons — so an order naming a business that is not featured,
 * or dropping one that is, is refused rather than applied as a side effect.
 */
export function orderProblem(current: readonly (string | null)[], proposed: readonly (string | null)[]): OrderProblem | null {
  if (proposed.length !== SLOT_COUNT) return "wrong_length";
  const ids = proposed.filter((id): id is string => id !== null);
  if (new Set(ids).size !== ids.length) return "duplicate";
  const had = current.filter((id): id is string => id !== null).sort();
  if (ids.length !== had.length || [...ids].sort().some((id, index) => id !== had[index])) return "different_members";
  return null;
}

export function sameOrder(a: readonly (string | null)[], b: readonly (string | null)[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// ── Chips (B8) ────────────────────────────────────────────────────────────────

export type ChipProblem = "label_length" | "query_empty" | "query_not_search" | "query_no_terms" | "query_too_long";

export type ChipQuery = { ok: true; query: string } | { ok: false; error: ChipProblem };

/** Keys a chip never carries: a page number, a list/grid choice and a map box are a visit, not a search. */
const VISIT_ONLY = { page: 1, view: "list", bounds: undefined } as const;

/**
 * What a chip runs, as the query string `/search` is linked with.
 *
 * Accepts the three things a person pastes: plain words ("pallet racking"), a
 * `/search?…` address copied from the results page with its facets set, or a
 * bare `q=…&emirate=…`. All three go through the results page's own parser and
 * back out through its own serialiser, so a chip can only ever say what the
 * page understands — an unknown key does not survive, which is the same guard
 * that closed the crawler facet trap.
 */
export function normaliseChipQuery(raw: string): ChipQuery {
  const input = raw.trim();
  if (!input) return { ok: false, error: "query_empty" };

  let params: URLSearchParams;
  if (input.startsWith("/") || /^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input, "https://directory.invalid");
    } catch {
      return { ok: false, error: "query_not_search" };
    }
    if (url.pathname !== "/search") return { ok: false, error: "query_not_search" };
    params = url.searchParams;
  } else if (input.startsWith("?") || /^[A-Za-z]+=/.test(input)) {
    params = new URLSearchParams(input.replace(/^\?/, ""));
  } else {
    params = new URLSearchParams({ q: input });
  }

  const record: Record<string, string[]> = {};
  for (const [key, value] of params) (record[key] ??= []).push(value);
  const parsed = parseSearchQuery(record);
  const query = toSearchParams({ ...parsed, ...VISIT_ONLY });

  const hasTerms = parsed.q.length > 0 || query.split("&").some((pair) => pair && !pair.startsWith("sort="));
  if (!query || !hasTerms) return { ok: false, error: "query_no_terms" };
  if (query.length > CHIP_QUERY_MAX) return { ok: false, error: "query_too_long" };
  return { ok: true, query };
}

export function chipLabelProblem(label: string): ChipProblem | null {
  const length = label.trim().length;
  return length < CHIP_LABEL_MIN || length > CHIP_LABEL_MAX ? "label_length" : null;
}

/** The address a chip links to. */
export function chipHref(query: string): string {
  return `/search?${query}`;
}

/**
 * The six chips the page fell back to before this board, carried into the table
 * by migration `20261028090000_homepage_curation_6h` and re-written by the seed.
 * A unit test holds the migration's rows equal to these.
 */
export const CARRIED_OVER_CHIPS: readonly { label: string; query: string }[] = [
  { label: "HVAC maintenance AMC", query: "q=HVAC+maintenance+AMC" },
  { label: "Steel fabrication", query: "q=Steel+fabrication" },
  { label: "Pallet racking", query: "q=Pallet+racking" },
  { label: "Trade licence renewal", query: "q=Trade+licence+renewal" },
  { label: "Corporate catering", query: "q=Corporate+catering" },
  { label: "Chilled water pumps", query: "q=Chilled+water+pumps" },
];
