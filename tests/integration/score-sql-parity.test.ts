import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { factorScores, scoreRow, DEFAULT_WEIGHTS, DEFAULT_SERVICES_WEIGHTS, WEIGHT_KEYS, type RankSignals, type RankingKind } from "@/lib/search/ranking";
import { factorScoresSql, scoreSql, type ScoreColumns } from "@/lib/search/score-sql";

/**
 * The control on T2.2's second implementation of the ranking arithmetic.
 *
 * `lib/search/score-sql.ts` computes in SQL what `lib/search/ranking.ts`
 * computes in the process, and a copy that drifts is the defect this project
 * keeps finding: the first symptom would be a results page ordered differently
 * from the one board 3a's attribution sentence explains, with nothing failing.
 *
 * So both run over the same rows and the numbers must agree. Factor by factor
 * rather than on the total, because one number that disagrees does not say
 * which of the six drifted — and the piecewise ones have knees at four hours, a
 * week, five kilometres and a hundred, which is where an off-by-one lives.
 *
 * The rows are chosen to sit *on* those knees and on both sides of each, plus
 * every null, because null is a half and not a nought in five of the six.
 */

const TABLE = Prisma.raw(`score_parity_${Date.now().toString(36)}`);

interface Row extends RankSignals {
  id: string;
}

/** Every boundary in `factorScores`, and the nulls. */
const ROWS: Row[] = [
  { id: "r01", relevance: 0, verificationTier: 0, responseTimeMedianMs: null, specCompleteness: null, distanceKm: null, planMultiplier: 1, scopeCompleteness: null, coverageMatch: null },
  { id: "r02", relevance: 1, verificationTier: 2, responseTimeMedianMs: 0, specCompleteness: 1, distanceKm: 0, planMultiplier: 1.35, scopeCompleteness: 1, coverageMatch: true },
  // The response-time knees: four hours exactly, a minute either side, a week.
  { id: "r03", relevance: 0.5, verificationTier: 1, responseTimeMedianMs: 4 * 3_600_000, specCompleteness: 0.5, distanceKm: 5, planMultiplier: 1.15, scopeCompleteness: 0.5, coverageMatch: false },
  { id: "r04", relevance: 0.5, verificationTier: 1, responseTimeMedianMs: 4 * 3_600_000 + 60_000, specCompleteness: 0.5, distanceKm: 5.1, planMultiplier: 1.15, scopeCompleteness: 0.5, coverageMatch: false },
  { id: "r05", relevance: 0.5, verificationTier: 1, responseTimeMedianMs: 7 * 24 * 3_600_000, specCompleteness: 0.5, distanceKm: 100, planMultiplier: 1.15, scopeCompleteness: 0.5, coverageMatch: false },
  { id: "r06", relevance: 0.5, verificationTier: 1, responseTimeMedianMs: 7 * 24 * 3_600_000 + 1, specCompleteness: 0.5, distanceKm: 100.5, planMultiplier: 1.15, scopeCompleteness: 0.5, coverageMatch: false },
  // Halfway along each ramp, where a wrong denominator shows.
  { id: "r07", relevance: 0.675, verificationTier: 2, responseTimeMedianMs: 90 * 3_600_000, specCompleteness: 0.33, distanceKm: 52.5, planMultiplier: 1.2, scopeCompleteness: 0.66, coverageMatch: true },
  // Out of range in both directions: a legacy tier above the ladder, a
  // multiplier below free, a completeness over one.
  { id: "r08", relevance: 1.4, verificationTier: 4, responseTimeMedianMs: -5, specCompleteness: 1.4, distanceKm: -3, planMultiplier: 0.5, scopeCompleteness: 1.4, coverageMatch: true },
  { id: "r09", relevance: -0.2, verificationTier: -1, responseTimeMedianMs: 60_000, specCompleteness: -0.2, distanceKm: 4.999, planMultiplier: 2, scopeCompleteness: -0.2, coverageMatch: false },
  // A plan row with no plan at all, which is what `Business.planId` being
  // nullable means on an imported licence record.
  { id: "r10", relevance: 0.2, verificationTier: 0, responseTimeMedianMs: 36 * 3_600_000, specCompleteness: 0.1, distanceKm: 40, planMultiplier: 1, scopeCompleteness: null, coverageMatch: null },
];

const COLUMNS: ScoreColumns = {
  relevance: Prisma.sql`relevance`,
  verificationTier: Prisma.sql`verification_tier`,
  responseTimeMedianMs: Prisma.sql`response_time_median_ms`,
  specCompleteness: Prisma.sql`spec_completeness`,
  scopeCompleteness: Prisma.sql`scope_completeness`,
  distanceKm: Prisma.sql`distance_km`,
  coverageMatch: Prisma.sql`coverage_match`,
  planMultiplier: Prisma.sql`plan_multiplier`,
};

beforeAll(async () => {
  await prisma.$executeRaw`
    CREATE TEMPORARY TABLE IF NOT EXISTS ${TABLE} (
      id text PRIMARY KEY,
      relevance double precision NOT NULL,
      verification_tier integer NOT NULL,
      response_time_median_ms integer,
      spec_completeness double precision,
      scope_completeness double precision,
      distance_km double precision,
      coverage_match boolean,
      plan_multiplier double precision
    )`;
  /*
     A temporary table, so two suites running against one database do not read
     each other's rows — and named with a timestamp as well, because a temp
     table is per *session* and the integration project shares a pool.
  */
  for (const row of ROWS) {
    await prisma.$executeRaw`
      INSERT INTO ${TABLE} (id, relevance, verification_tier, response_time_median_ms,
        spec_completeness, scope_completeness, distance_km, coverage_match, plan_multiplier)
      VALUES (${row.id}, ${row.relevance}, ${row.verificationTier}, ${row.responseTimeMedianMs},
        ${row.specCompleteness ?? null}, ${row.scopeCompleteness ?? null}, ${row.distanceKm ?? null},
        ${row.coverageMatch ?? null}, ${row.planMultiplier})`;
  }
});

afterAll(async () => {
  await prisma.$executeRaw`DROP TABLE IF EXISTS ${TABLE}`;
});

/** Postgres and V8 both do this in `double precision`; the slack is for the divisions. */
const CLOSE = 1e-9;

for (const vector of ["goods", "services"] as RankingKind[]) {
  const weights = vector === "services" ? DEFAULT_SERVICES_WEIGHTS : DEFAULT_WEIGHTS;

  describe(`the ${vector} vector scores the same in SQL as in the process`, () => {
    it("agrees on every factor, row by row", async () => {
      const factors = factorScoresSql(COLUMNS, vector);
      const select = Prisma.join(
        WEIGHT_KEYS.map((key) => Prisma.sql`(${factors[key]}) AS ${Prisma.raw(`"f_${key}"`)}`),
        ", ",
      );
      const rows = await prisma.$queryRaw<Record<string, string | number>[]>(
        Prisma.sql`SELECT id, ${select} FROM ${TABLE} ORDER BY id`,
      );
      expect(rows).toHaveLength(ROWS.length);

      for (const row of rows) {
        const expected = factorScores(ROWS.find((r) => r.id === row.id)!, vector);
        for (const key of WEIGHT_KEYS) {
          expect(Number(row[`f_${key}`]), `${String(row.id)} · ${key}`).toBeCloseTo(
            expected[key],
            9,
          );
        }
      }
    });

    it("agrees on the weighted total, which is what the ORDER BY uses", async () => {
      const rows = await prisma.$queryRaw<{ id: string; score: number }[]>(
        Prisma.sql`SELECT id, (${scoreSql(COLUMNS, weights, vector)}) AS score FROM ${TABLE} ORDER BY id`,
      );
      for (const row of rows) {
        const signals = ROWS.find((r) => r.id === row.id)!;
        expect(Math.abs(Number(row.score) - scoreRow(signals, weights, vector))).toBeLessThan(CLOSE);
      }
    });

    it("orders the rows identically, which is the only thing a buyer sees", async () => {
      /*
         The property that actually matters. Two scores can agree to nine places
         and still order differently if a tie is broken differently, so the
         comparison is on the sequence of ids and the tie-break is the same
         `id` both sides use.
      */
      const rows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM ${TABLE}
                   ORDER BY (${scoreSql(COLUMNS, weights, vector)}) DESC, id ASC`,
      );
      const inProcess = [...ROWS]
        .map((row) => ({ id: row.id, score: scoreRow(row, weights, vector) }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .map((row) => row.id);
      expect(rows.map((row) => row.id)).toEqual(inProcess);
    });
  });
}

describe("a boost is added after the weighted sum, not weighted into it", () => {
  it("moves the total by exactly its own points", async () => {
    // `scoreRow` adds `boostPoints` outside the sum so that five points is five
    // points whatever the weights are this week. The SQL does not know about
    // boosts at all; the caller adds them, and this pins the contract.
    const signals = ROWS[6]!;
    const plain = scoreRow(signals, DEFAULT_WEIGHTS, "goods");
    const boosted = scoreRow({ ...signals, boostPoints: 5 }, DEFAULT_WEIGHTS, "goods");
    expect(boosted - plain).toBeCloseTo(5, 9);

    const [row] = await prisma.$queryRaw<{ score: number }[]>(
      Prisma.sql`SELECT (${scoreSql(COLUMNS, DEFAULT_WEIGHTS, "goods")}) AS score
                 FROM ${TABLE} WHERE id = ${signals.id}`,
    );
    expect(Math.abs(Number(row!.score) - plain)).toBeLessThan(CLOSE);
  });
});
