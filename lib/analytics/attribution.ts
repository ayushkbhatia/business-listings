import {
  WEIGHT_KEYS,
  type FactorScores,
  type RankingWeights,
  type WeightKey,
} from "@/lib/search/ranking";

/**
 * The `3a`/`3l` amendment — why a position moved, as arithmetic.
 *
 * Pure, and that is the point twice over. Board `3l`'s model module makes the
 * argument for the first reason: testing it needs no database. The second is
 * particular to this file — **a fall the seller did not cause must not read as
 * one they did**, and three of the six states exist only to say so. A rule that
 * important is one that has to be provable at a desk.
 *
 * ## The decomposition is exact, not a heuristic
 *
 * A listing's score is `Σ w·s` plus its boost points. Between two days both
 * halves of every term can move: the seller's own measurements change, and
 * staff change the weights on board `12c`. The identity
 *
 *     w'·s' − w·s  ≡  w·(s' − s)  +  s'·(w' − w)
 *
 * splits each factor's contribution into the part the seller moved and the part
 * we moved, with no remainder. Summed over the six factors it gives three
 * numbers — what the seller did, what we did, and what their boost did — and
 * whichever is largest is what the sentence is about.
 *
 * Without this, every fall is billed to the seller: the platform-caused case is
 * indistinguishable from the seller-caused one, and it is the more common of the
 * two on the day somebody moves a slider.
 *
 * ## What this file cannot do, and does not pretend to
 *
 * The spec asks that *"a factor that did not move the position by at least one
 * place is not named at all"*. Knowing that exactly means re-ranking the whole
 * category with one factor held at its old value, six times, per listing, per
 * day — a different and much larger job. This approximates it with a floor on
 * the contribution change, which is the quantity the ranker actually consumed.
 * The floor is stated below rather than tuned quietly.
 */

/** The measurements behind the scores, in the units a seller would recognise. */
export interface RawFactors {
  /** Null on a category listing: there is no query to be relevant to. */
  relevance: number | null;
  /** 0..2 on the ladder as it stands. */
  verificationTier: number;
  responseTimeMedianMs: number | null;
  /** 0..1 filled ratio. */
  specCompleteness: number | null;
  distanceKm: number | null;
  planMultiplier: number;
}

/** One day of what the ranker saw. The shape `ListingFactorDay` stores. */
export interface FactorDay {
  scores: FactorScores;
  raw: RawFactors;
  weights: RankingWeights;
  boostPoints: number;
}

/**
 * A factor has to move the weighted score by this much to be named.
 *
 * Half a point on a hundred-point scale. Below it the sentence is noise: a
 * spec-completeness ratio that drifted by a thousandth because one product
 * gained a field is true, uninteresting, and — printed as the reason a seller
 * lost two places — actively misleading about what would win them back.
 */
export const NAMEABLE_POINTS = 0.5;

/**
 * Above this share of the movement, one factor is *the* reason.
 *
 * Spec Q2: name the largest contributor, and where none dominates let the count
 * stand alone. Naming one arbitrary factor of three that moved together is
 * worse than naming none, because the seller acts on the one we printed.
 */
export const DOMINANT_SHARE = 0.5;

export type Direction = "up" | "down";

/**
 * Why a position moved, or the honest absence of a reason.
 *
 * `none` is a finished state and not a gap. A held position has no reason, and
 * neither does a rise caused by somebody else's decline — a rank and a movement
 * with nothing beneath them is complete.
 */
export type Attribution =
  | { kind: "none" }
  /** 08 · One factor of theirs, with its before and after. */
  | {
      kind: "seller";
      direction: Direction;
      places: number;
      factor: WeightKey;
      trend: Direction;
      before: RawFactors;
      after: RawFactors;
    }
  /** 09 · Staff moved a weight on `12c`. Never the seller's fault. */
  | { kind: "platform"; on: Date }
  /** 10 · A paid boost ended, and the position returned to the earned one. */
  | { kind: "commercial"; endedOn: Date; earnedRank: number | null }
  /** 11 · Their factors held; somebody above them improved. */
  | { kind: "competitor"; count: number; factor: WeightKey }
  /** 12 · Several moved. `factor` is null where none dominates. */
  | {
      kind: "multiple";
      count: number;
      direction: Direction;
      factor: WeightKey | null;
      trend: Direction;
      before: RawFactors;
      after: RawFactors;
    }
  /** 13 · A hole in the history. Says so, and never invents a cause. */
  | { kind: "unexplained"; historyStarts: Date };

export const NO_REASON: Attribution = { kind: "none" };

/** What each source contributed to the score change, in weighted points. */
export interface Decomposition {
  /** `Σ w·Δs` — the seller's own measurements, at last night's weights. */
  seller: number;
  /** `Σ s'·Δw` — what board `12c` did, scored against today's listing. */
  platform: number;
  /** `Δ boost points`. */
  boost: number;
  /** Per factor, the seller's share: `w·Δs`. */
  byFactor: Record<WeightKey, number>;
}

/**
 * Split the change in a listing's score into what moved it.
 *
 * Exact: `seller + platform + boost` is the whole difference in `scoreRow`
 * between the two days, to floating-point precision. That is worth keeping true
 * — the moment it is approximate, a residual starts landing on whichever source
 * the code happens to check first.
 */
export function decompose(before: FactorDay, after: FactorDay): Decomposition {
  const byFactor = {} as Record<WeightKey, number>;
  let seller = 0;
  let platform = 0;

  for (const key of WEIGHT_KEYS) {
    const sellerPart = before.weights[key] * (after.scores[key] - before.scores[key]);
    const platformPart = after.scores[key] * (after.weights[key] - before.weights[key]);
    byFactor[key] = sellerPart;
    seller += sellerPart;
    platform += platformPart;
  }

  return { seller, platform, boost: after.boostPoints - before.boostPoints, byFactor };
}

/**
 * Which way the seller's own *measurement* went — not its score.
 *
 * Two of the six invert. A median reply time of 31 hours is a worse score than
 * one of 4 hours, and taking the direction from the score produced the sentence
 * *"your measured reply time fell from 4 h to 1 d 7 h"* — a fall whose second
 * number is larger than its first. Distance behaves the same way.
 *
 * So the direction comes from the raw value wherever there is one on both days,
 * and from the score only where the raw is unmeasured. The score's own direction
 * is still what decides whether the *position* rose or fell; this is about the
 * clause that follows.
 *
 * Found by loading the page rather than by a test, which is the argument for
 * loading the page.
 */
function rawTrend(
  factor: WeightKey,
  before: RawFactors,
  after: RawFactors,
  beforeScores: FactorScores,
  afterScores: FactorScores,
): Direction {
  const pair = RAW_OF[factor];
  const was = pair ? pair(before) : null;
  const is = pair ? pair(after) : null;
  if (was !== null && is !== null && was !== is) return is > was ? "up" : "down";
  return afterScores[factor] >= beforeScores[factor] ? "up" : "down";
}

/** The measurement behind each factor, where the sentence quotes one. */
const RAW_OF: Partial<Record<WeightKey, (raw: RawFactors) => number | null>> = {
  responseTime: (raw) => raw.responseTimeMedianMs,
  specCompleteness: (raw) => raw.specCompleteness,
  verificationTier: (raw) => raw.verificationTier,
  distance: (raw) => raw.distanceKm,
  planTier: (raw) => raw.planMultiplier,
  relevance: (raw) => raw.relevance,
};

/** Everything the sentence needs that is not in the two factor rows. */
export interface AttributionInput {
  /** Null where there is no history to compare against — state 13. */
  before: FactorDay | null;
  after: FactorDay;
  /** One-based, and both from `CategoryRankDay` or both from the query rollup. */
  positionBefore: number | null;
  positionAfter: number | null;
  /**
   * The first day this listing has factor history for.
   *
   * Read, never hardcoded: it is the 90-day prune boundary for an established
   * listing and the seller's own start date for a new one, and state 13 prints
   * whichever it is.
   */
  historyStarts: Date;
  /**
   * The day the `after` row belongs to.
   *
   * State 09 prints it — *"We changed how search results are ordered on 2 Sep"*
   * — and it is the caller's to supply because it is a property of the row that
   * was read, not of the two vectors being compared.
   */
  on: Date;
  /** When a boost ended inside the window, if one did. */
  boostEndedOn?: Date | null;
  /** The position held the day before that boost began, where it is recoverable. */
  earnedRank?: number | null;
  /**
   * Listings that overtook this one and what they most improved.
   *
   * Aggregate only — a count and a factor name. No competitor is ever named to
   * a seller, on any surface, for any reason.
   */
  overtakenBy?: { count: number; factor: WeightKey } | null;
}

/**
 * The one sentence, chosen.
 *
 * Order is not arbitrary. A boost ending is checked before anything else
 * because it is both the largest single move available — up to
 * `MAX_BOOST_POINTS` — and the only one where silence lets a seller mourn a
 * position they never earned. The platform's own weight change comes next among
 * equals for the same reason the amendment exists: where we moved a listing and
 * the seller also drifted, saying it was ours is the honest half.
 */
export function attribute(input: AttributionInput): Attribution {
  const { before, after, positionBefore, positionAfter } = input;

  // No movement to explain. A held position's reason is that nothing happened.
  if (positionBefore === null || positionAfter === null) return NO_REASON;
  const places = positionAfter - positionBefore;
  if (places === 0) return NO_REASON;

  // State 13. History has a hole, so there is nothing to diff — and the honest
  // sentence names where the history actually starts rather than shrugging.
  if (!before) return { kind: "unexplained", historyStarts: input.historyStarts };

  const direction: Direction = places < 0 ? "up" : "down";
  const magnitude = Math.abs(places);
  const parts = decompose(before, after);

  // State 10. A boost that ended is a return to the earned position, not a loss.
  if (input.boostEndedOn && parts.boost < 0) {
    return {
      kind: "commercial",
      endedOn: input.boostEndedOn,
      earnedRank: input.earnedRank ?? null,
    };
  }

  const sellerSize = Math.abs(parts.seller);
  const platformSize = Math.abs(parts.platform);

  // State 09. We changed how results are ordered, and every listing in the
  // category moved with it.
  if (platformSize >= NAMEABLE_POINTS && platformSize >= sellerSize) {
    return { kind: "platform", on: input.on };
  }

  // State 11. Their own contribution did not move in any nameable way, and the
  // position did — so somebody above them improved. The commonest fall on the
  // board, and the one with no call to action by design.
  if (sellerSize < NAMEABLE_POINTS) {
    return input.overtakenBy && input.overtakenBy.count > 0
      ? { kind: "competitor", count: input.overtakenBy.count, factor: input.overtakenBy.factor }
      : NO_REASON;
  }

  const moved = WEIGHT_KEYS.filter((key) => Math.abs(parts.byFactor[key]) >= NAMEABLE_POINTS);
  const leader = moved.reduce<WeightKey | null>(
    (best, key) =>
      best === null || Math.abs(parts.byFactor[key]) > Math.abs(parts.byFactor[best]) ? key : best,
    null,
  );

  // Every nameable factor fell below the floor once measured individually, even
  // though their sum did not. Nothing to name, and a count of one is not
  // "several" — so this is the same finished absence as a held position.
  if (!leader) return NO_REASON;

  const share = Math.abs(parts.byFactor[leader]) / sellerSize;
  const trend = rawTrend(leader, before.raw, after.raw, before.scores, after.scores);

  // State 12. Several moved together, so the count carries the sentence and the
  // leader is named only where it actually accounts for most of the movement.
  if (moved.length > 1) {
    return {
      kind: "multiple",
      count: moved.length,
      direction,
      factor: share >= DOMINANT_SHARE ? leader : null,
      trend,
      before: before.raw,
      after: after.raw,
    };
  }

  // State 08.
  return {
    kind: "seller",
    direction,
    places: magnitude,
    factor: leader,
    trend,
    before: before.raw,
    after: after.raw,
  };
}
