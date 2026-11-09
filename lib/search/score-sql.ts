import { Prisma } from "@/lib/db/generated/client";
import { TOP_ACHIEVABLE_TIER } from "@/lib/verification";
import {
  FACTOR_SOURCES,
  WEIGHT_KEYS,
  type RankingKind,
  type RankingWeights,
} from "./ranking";

/**
 * Task T2.2 — `factorScores` and `scoreRow`, as a SQL expression.
 *
 * The ranking has always been computed in the process over a bounded candidate
 * set: `searchBusinesses` took two hundred rows with **no `orderBy`**, scored
 * them, sorted them and sliced a page out of the result, while the total
 * underneath came from a real `count()` of the whole match. So the two hundred
 * were whichever two hundred Postgres happened to return, the ordering was over
 * an arbitrary sample, and every page past the tenth was empty beneath a total
 * claiming nineteen hundred.
 *
 * Ordering in the database is the only fix that is both correct and bounded —
 * `docs/production-build-plan.md` §13 forbids an unbounded `findMany` on a
 * request path, which is what ranking the whole matched set in the process
 * would be. Measured on the 41,000-row harness, that read costs 178 ms for an
 * empty query; this costs the page.
 *
 * ## A second implementation of the arithmetic, and how it is kept honest
 *
 * This is the thing the project warns about: a copy that drifts, whose first
 * symptom is a results page ordered differently from the one the attribution
 * sentence on board 3a explains. Three defences, in order of how much they are
 * worth:
 *
 *  1. **The weights are interpolated, never written here.** They come from the
 *     same `RankingWeights` the process ranker is handed — board 12c's stored
 *     vector — so a weight staff move moves both.
 *  2. **The shape is one function per factor**, named after the TypeScript one
 *     it mirrors, so a reviewer reads them side by side.
 *  3. **`score-sql.test.ts` runs both over the same rows** and asserts the
 *     numbers agree to 1e-9. Postgres does the arithmetic in `double
 *     precision` and so does V8, so the agreement is exact in practice and the
 *     tolerance is there for the division only.
 *
 * ## What is not here
 *
 * `boostPoints` is added by the caller, after the weighted sum, exactly as
 * `scoreRow` adds it — a boost is a nudge with an expiry rather than a seventh
 * signal, and the whole point of adding it afterwards is that five points is
 * five points whatever the weights are this week.
 *
 * `relevance` is a parameter rather than an expression, because what it means
 * depends on the surface: a text query scores the match surface, and a landing
 * page scores category-match depth. The caller hands in the expression; this
 * weights it.
 */

/** Unmeasured scores a half, never a nought — `UNKNOWN` in `ranking.ts`. */
const UNKNOWN = Prisma.sql`0.5`;

const HOUR = 3_600_000;

/**
 * `scoreResponseTime`, as SQL.
 *
 * Null is half credit: a supplier with no enquiries yet has no median, and
 * scoring that as the slowest possible would bury every listing on its first
 * day. One at four hours or better, nought at a week or worse, linear between.
 */
function responseTimeSql(column: Prisma.Sql): Prisma.Sql {
  const fast = 4 * HOUR;
  const slow = 7 * 24 * HOUR;
  return Prisma.sql`CASE
    WHEN ${column} IS NULL THEN ${UNKNOWN}
    WHEN ${column} <= ${fast} THEN 1.0
    WHEN ${column} >= ${slow} THEN 0.0
    ELSE 1.0 - ((${column}::double precision - ${fast}) / ${slow - fast})
  END`;
}

/**
 * `scoreDistance`, as SQL. Kilometres, one at five or nearer, nought at a
 * hundred or further, and a half for not knowing — because not knowing where
 * somebody is must not read as evidence that they are inconvenient.
 */
function distanceSql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN ${column} IS NULL THEN ${UNKNOWN}
    WHEN ${column} <= 5 THEN 1.0
    WHEN ${column} >= 100 THEN 0.0
    ELSE 1.0 - ((${column}::double precision - 5) / 95)
  END`;
}

/** `scoreCoverage`: the services vector's fifth slot. Binary, half for unknown. */
function coverageSql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN ${column} IS NULL THEN ${UNKNOWN}
    WHEN ${column} THEN 1.0
    ELSE 0.0
  END`;
}

/**
 * `trustScore`: the tier over the top rung the ladder actually has.
 *
 * Two, not the four the ladder stopped having when site visits were withdrawn.
 * Imported rather than written, for the reason `lib/verification.ts` gives: two
 * scores divided by 4 for a fortnight and nobody noticed, because a divisor is
 * the one corpus no scan reads.
 */
function trustSql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`LEAST(1.0, GREATEST(0.0, ${column}::double precision) / ${TOP_ACHIEVABLE_TIER})`;
}

/** `scorePlan`: 1.0 free to 1.35 pro, mapped onto 0..1 so the weight means what it says. */
function planSql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`LEAST(1.0, GREATEST(0.0, (COALESCE(${column}, 1)::double precision - 1) / 0.35))`;
}

/** A 0..1 signal that may be null, clamped, with null at a half. */
function unitSql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN ${column} IS NULL THEN ${UNKNOWN}
    ELSE LEAST(1.0, GREATEST(0.0, ${column}::double precision))
  END`;
}

/**
 * The columns a score reads, as expressions the caller names.
 *
 * Passed in rather than assumed, because the same arithmetic runs over a
 * `business` row in one query and over a test table in another, and the
 * parity test is worth more than the convenience of hardcoding `b.`.
 */
export interface ScoreColumns {
  /** 0..1, already computed by the caller. Text relevance or category depth. */
  relevance: Prisma.Sql;
  verificationTier: Prisma.Sql;
  responseTimeMedianMs: Prisma.Sql;
  /** The goods vector's fourth slot. */
  specCompleteness: Prisma.Sql;
  /** The services vector's fourth slot — `FACTOR_SOURCES` picks between them. */
  scopeCompleteness: Prisma.Sql;
  /** Kilometres, for the goods vector's fifth slot. */
  distanceKm: Prisma.Sql;
  /** Boolean, for the services vector's fifth slot. */
  coverageMatch: Prisma.Sql;
  planMultiplier: Prisma.Sql;
}

/**
 * The six normalised factors, keyed as `FactorScores` is.
 *
 * Exported for the parity test, which compares them one at a time: a single
 * number that disagrees tells you nothing about which factor drifted.
 */
export function factorScoresSql(
  columns: ScoreColumns,
  vector: RankingKind = "goods",
): Record<(typeof WEIGHT_KEYS)[number], Prisma.Sql> {
  const sources = FACTOR_SOURCES[vector];
  return {
    relevance: Prisma.sql`LEAST(1.0, GREATEST(0.0, ${columns.relevance}::double precision))`,
    verificationTier: trustSql(columns.verificationTier),
    responseTime: responseTimeSql(columns.responseTimeMedianMs),
    specCompleteness: unitSql(
      sources.specCompleteness === "scope" ? columns.scopeCompleteness : columns.specCompleteness,
    ),
    distance:
      sources.distance === "coverage"
        ? coverageSql(columns.coverageMatch)
        : distanceSql(columns.distanceKm),
    planTier: planSql(columns.planMultiplier),
  };
}

/**
 * `scoreRow` without the boost: the weighted sum of the six.
 *
 * The weights are numbers from the stored vector, interpolated as parameters,
 * so this is one plan Postgres can reuse across requests and one place a
 * weight change takes effect.
 */
export function scoreSql(
  columns: ScoreColumns,
  weights: RankingWeights,
  vector: RankingKind = "goods",
): Prisma.Sql {
  const factors = factorScoresSql(columns, vector);
  return Prisma.join(
    WEIGHT_KEYS.map((key) => Prisma.sql`(${weights[key]}::double precision * (${factors[key]}))`),
    " + ",
  );
}
