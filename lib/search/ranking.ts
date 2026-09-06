/**
 * Ranking weights, as a config object.
 *
 * Board 12c sets these. They live here rather than inline in the query so the
 * admin editor in handoff 4 has one thing to write to, and so a change is a
 * diff somebody can review rather than a line buried in SQL.
 *
 * Plan tier is deliberately the smallest weight. Above about 10 the results
 * stop being useful and buyers notice inside a week — a directory that sells
 * its way to the top is a directory nobody comes back to, and the subscription
 * only holds if being found is worth paying for.
 */
import { trustScore } from "@/lib/verification";

export interface RankingWeights {
  relevance: number;
  verificationTier: number;
  responseTime: number;
  specCompleteness: number;
  distance: number;
  planTier: number;
}

/**
 * The weight names, in the order the editor shows them.
 *
 * Here rather than in `settings.ts` because a client component needs them and
 * that module is `server-only` — importing it from the editor pulled Prisma and
 * `pg` into the browser bundle, which typecheck and lint both allowed and the
 * build caught.
 */
export const WEIGHT_KEYS = [
  "relevance",
  "verificationTier",
  "responseTime",
  "specCompleteness",
  "distance",
  "planTier",
] as const;

/**
 * What `relevance` means on a page with no query — board 6a §Ranking.
 *
 * The area and emirate landing pages rank on this same config, and they have no
 * search box. `relevance` is the largest of the six weights and there is
 * nothing on those pages for it to score against, so left alone it multiplies
 * zero: staff move a 34-point slider on board 12c and nothing changes on the
 * highest-traffic template in the product. That is worse than a wrong number,
 * because it looks like it works.
 *
 *   `redistribute`    the 34 points spread across the other five in proportion
 *                     to their own weights. Verification becomes the dominant
 *                     signal at roughly 35 effective points, which is what the
 *                     H2 on those pages promises the reader.
 *   `category_depth`  relevance keeps its points, and the caller scores it as
 *                     how exactly a listing's own trade matches the page's —
 *                     primary category exact scores 1, a match at sector level
 *                     scores half.
 *
 * A named mode on the same config row, never a constant in a route: the spec
 * asks for the decision to be recorded where the weights are, so that whoever
 * moves a weight can see what it does to the pages with no query.
 */
export const BROWSE_RELEVANCE_MODES = ["redistribute", "category_depth"] as const;
export type BrowseRelevanceMode = (typeof BROWSE_RELEVANCE_MODES)[number];
export const DEFAULT_BROWSE_RELEVANCE_MODE: BrowseRelevanceMode = "redistribute";

export function isBrowseRelevanceMode(value: string): value is BrowseRelevanceMode {
  return (BROWSE_RELEVANCE_MODES as readonly string[]).includes(value);
}

/**
 * The weights a page with no query should rank on.
 *
 * Under `category_depth` nothing moves — the caller supplies a real relevance
 * score and the config is used as staff set it.
 *
 * Under `redistribute` the relevance points are shared out in proportion to the
 * other five, and relevance goes to zero. Two properties matter and both are
 * asserted in the unit tests:
 *
 *   · the total stays the same, so a score from this page is on the same scale
 *     as a score from a search and a boost's five points still mean five;
 *   · a weight staff set to nought stays at nought. Redistributing *into* a
 *     signal somebody deliberately switched off would make the admin editor a
 *     suggestion, which is the same objection `weightsForShape` records.
 *
 * Rounding is by largest remainder rather than `Math.round` per weight, which
 * loses or invents points depending on the numbers. With every other weight at
 * zero there is nothing to redistribute into and the relevance points are
 * dropped rather than parked somewhere arbitrary — a config of "relevance
 * only" on a page with no query is a config with no ranking in it, and
 * `setWeights` already refuses the all-zero case that would produce it.
 */
export function weightsForBrowse(
  weights: RankingWeights,
  mode: BrowseRelevanceMode = DEFAULT_BROWSE_RELEVANCE_MODE,
): RankingWeights {
  if (mode === "category_depth") return { ...weights };

  const others = WEIGHT_KEYS.filter((key) => key !== "relevance");
  const base = others.reduce((total, key) => total + weights[key], 0);
  if (base === 0 || weights.relevance === 0) return { ...weights, relevance: 0 };

  const exact = others.map((key) => ({
    key,
    share: (weights.relevance * weights[key]) / base,
  }));
  const shared = exact.map((entry) => ({ ...entry, whole: Math.floor(entry.share) }));
  let left = weights.relevance - shared.reduce((total, entry) => total + entry.whole, 0);

  // Largest remainder first, then the bigger weight, so the result does not
  // depend on the order `WEIGHT_KEYS` happens to be written in.
  const order = [...shared].sort(
    (a, b) => (b.share - b.whole) - (a.share - a.whole) || weights[b.key] - weights[a.key],
  );
  const extra = new Map(order.map((entry) => [entry.key, 0]));
  for (const entry of order) {
    if (left <= 0) break;
    extra.set(entry.key, 1);
    left -= 1;
  }

  const next: RankingWeights = { ...weights, relevance: 0 };
  for (const entry of shared) {
    next[entry.key] = weights[entry.key] + entry.whole + (extra.get(entry.key) ?? 0);
  }
  return next;
}

/** Above this the results stop being useful and buyers notice inside a week. */
export const PLAN_TIER_CEILING = 10;
/** A boost bigger than this replaces the ranking rather than nudging it. */
export const MAX_BOOST_POINTS = 25;
/** A boost cannot outlive the quarter somebody is thinking about. */
export const MAX_BOOST_DAYS = 90;

export const DEFAULT_WEIGHTS: RankingWeights = {
  relevance: 34,
  verificationTier: 22,
  responseTime: 18,
  specCompleteness: 12,
  distance: 8,
  planTier: 6,
};

/** Every signal a rankable row carries. Each is normalised to 0..1 below. */
export interface RankSignals {
  /** 0..1 from the text match. 1 for an exact name hit. */
  relevance: number;
  /** 0..4 from the database. */
  verificationTier: number;
  /** Median enquiry-to-first-reply. Null when unmeasured. */
  responseTimeMedianMs: number | null;
  /** 0..1 filled ratio. Null when the category has no template. */
  specCompleteness: number | null;
  /** Kilometres from the buyer. Null when we do not know where they are. */
  distanceKm: number | null;
  /** From Plan.rankingMultiplier — 1.0 free, 1.15 basic, 1.35 pro. */
  planMultiplier: number;
  /**
   * Points from a live `ListingBoost`, added on top rather than weighted.
   *
   * A boost is a nudge with a reason and an expiry, not a seventh signal — it
   * has no natural 0..1 shape and it is not a property of the listing. Added
   * after the weighted sum so its size is legible: five points is five points,
   * whatever the weights happen to be this week.
   */
  boostPoints?: number;
}

const HOUR = 3_600_000;

/**
 * An unmeasured signal scores 0.5, not 0.
 *
 * A new supplier with no enquiries yet has no response time, and scoring that
 * as "slowest possible" would bury every listing on its first day — which is
 * how a directory ends up with a frozen top ten. Half credit is the honest
 * position: we do not know.
 */
const UNKNOWN = 0.5;

function scoreResponseTime(ms: number | null): number {
  if (ms === null) return UNKNOWN;
  if (ms <= 4 * HOUR) return 1;
  if (ms >= 7 * 24 * HOUR) return 0;
  // Linear between four hours and a week. A buyer feels the difference between
  // two hours and two days; they do not feel the one between six and seven.
  return 1 - (ms - 4 * HOUR) / (7 * 24 * HOUR - 4 * HOUR);
}

function scoreDistance(km: number | null): number {
  // We do not ask for a location and most buyers arrive without one. Half
  // credit keeps the weight from silently becoming a penalty on everyone.
  if (km === null) return UNKNOWN;
  if (km <= 5) return 1;
  if (km >= 100) return 0;
  return 1 - (km - 5) / 95;
}

function scorePlan(multiplier: number): number {
  // 1.0 free, 1.35 pro. Mapped onto 0..1 so the weight means what it says.
  return Math.min(1, Math.max(0, (multiplier - 1) / 0.35));
}

export function scoreRow(signals: RankSignals, weights: RankingWeights = DEFAULT_WEIGHTS): number {
  const parts: [number, number][] = [
    [weights.relevance, Math.min(1, Math.max(0, signals.relevance))],
    /*
       Normalised against the top achievable rung — 2 — and not the 4 the ladder
       stopped having when site visits were withdrawn. Until this, the strongest
       verification a supplier can hold contributed three quarters of the
       verification weight, which is 22 of 100 on this scale: the whole
       directory ranked as though every verified listing were one rung short of
       something nobody can reach.
    */
    [weights.verificationTier, trustScore(signals.verificationTier)],
    [weights.responseTime, scoreResponseTime(signals.responseTimeMedianMs)],
    [weights.specCompleteness, signals.specCompleteness ?? UNKNOWN],
    [weights.distance, scoreDistance(signals.distanceKm)],
    [weights.planTier, scorePlan(signals.planMultiplier)],
  ];
  const weighted = parts.reduce((total, [weight, score]) => total + weight * score, 0);
  return weighted + (signals.boostPoints ?? 0);
}

export function rank<T>(
  rows: readonly T[],
  signalsOf: (row: T) => RankSignals,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): T[] {
  return [...rows]
    .map((row) => ({ row, score: scoreRow(signalsOf(row), weights) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row);
}

/**
 * Place the sponsored slot.
 *
 * One per results page, always labelled. It never outranks a verified supplier
 * on a filter the buyer explicitly set: a buyer who ticked "tier 3 and up" has
 * told us what they care about, and selling the top of that list is the fastest
 * way to make the filter worthless. When such a filter is set the sponsor stays
 * in its natural rank position — still labelled, never promoted.
 */
export function placeSponsored<T>(
  ranked: readonly T[],
  sponsoredId: string | null,
  idOf: (row: T) => string,
  buyerSetAVerificationFilter: boolean,
): { rows: T[]; sponsoredId: string | null } {
  if (!sponsoredId) return { rows: [...ranked], sponsoredId: null };

  const index = ranked.findIndex((row) => idOf(row) === sponsoredId);
  if (index === -1) return { rows: [...ranked], sponsoredId: null };

  if (buyerSetAVerificationFilter) return { rows: [...ranked], sponsoredId };

  const rows = [...ranked];
  const [sponsor] = rows.splice(index, 1);
  return { rows: [sponsor!, ...rows], sponsoredId };
}
