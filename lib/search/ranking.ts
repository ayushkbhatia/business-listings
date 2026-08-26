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
    [weights.verificationTier, Math.min(1, signals.verificationTier / 4)],
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
