import "server-only";
import { Prisma, type Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { PUBLIC_BUSINESS } from "@/lib/db/queries/search";
import { dubaiDayStart } from "@/lib/format";
import {
  factorScores,
  scoreRow,
  weightsForBrowse,
  type RankingWeights,
} from "@/lib/search/ranking";
import { liveBoosts, liveBrowseRelevanceMode, liveWeights } from "@/lib/search/settings";
import type { RawFactors } from "./attribution";

/**
 * The amendment's `B1` and `B2` — the nightly snapshot.
 *
 * Board `3l` shipped two position tables and both are **counters**. They are
 * written by `recordSearchImpressions` and `recordCategoryPositions` when a real
 * buyer loads a page, which makes them exactly right about how often a listing
 * was seen and unusable as a series: a category nobody browsed on Tuesday has no
 * Tuesday row, and an arrow computed across that hole silently compares Monday
 * to Thursday and calls the difference a day's movement.
 *
 * At forty listings that is not an edge case. It is most days, for most sellers.
 *
 * So this runs whether anybody looked or not, and it writes two things:
 *
 *   `CategoryRankDay`   where each listing sat in each category listing it
 *                       appears in, and how many listings it was ranked against
 *   `ListingFactorDay`  what the ranker saw when it put them there
 *
 * ## The scope set is supply, not a cross product
 *
 * Seven emirates and a country-wide scope over every category would be eight
 * rankings per category per night for scopes with nobody in them. The scopes
 * that exist are the ones with supply: every category gets its country-wide
 * listing, and gains an emirate listing only where a published business in that
 * category actually has a branch there. A Dubai-only supplier in two categories
 * costs four rows a night, and the table grows with the directory rather than
 * with the enum.
 *
 * ## Relevance, and what a per-listing vector cannot hold
 *
 * On a category listing `relevance` is category-match depth — a listing whose
 * primary trade is exactly this page's scores 1, one that matches at sector
 * level scores half — so it is a property of the *pair* and not of the listing.
 * `ListingFactorDay` is per listing, so it stores the primary-category value.
 *
 * The consequence is stated rather than hidden: a seller who changes their
 * primary trade moves in every other category listing they appear in, and this
 * vector will not show it. Attribution then falls through to the competitor
 * state, which says their factors did not change — true of the vector, and not
 * of the ranking. It is the one case where the sentence is thinner than the
 * truth, and the alternative is a factor row per category per listing per day.
 */

/** What one night of the job did. Reported, never guessed at. */
export interface SnapshotResult {
  day: Date;
  /** Businesses that got a factor row. */
  listings: number;
  /** `(category, emirate)` pairs ranked, country-wide scopes included. */
  scopes: number;
  /** Rows written to `CategoryRankDay`. */
  ranks: number;
  /**
   * Categories not ranked because the directory is larger than one night's
   * budget. Zero in every state this platform has been in; reported anyway,
   * because a silent cap reads as "we covered everything" when it did not.
   */
  skipped: string[];
  ranAt: Date;
}

/**
 * How many listings one run will rank.
 *
 * Not a page size — the whole directory goes through this in memory, once, and
 * the ranking itself is arithmetic over six numbers. The cap exists so that a
 * bulk import cannot turn a nightly job into an overnight one without anybody
 * noticing, and `skipped` says out loud when it bites.
 */
export const MAX_LISTINGS = 20_000;

/** Rows per `INSERT`. Postgres takes far more; this keeps a statement legible. */
const CHUNK = 500;

interface Candidate {
  id: string;
  primaryCategoryId: string;
  categoryIds: string[];
  emirates: Emirate[];
  score: number;
  factors: { scores: ReturnType<typeof factorScores>; raw: RawFactors };
}

export async function runPositionSnapshots(now: Date = new Date()): Promise<SnapshotResult> {
  const day = dubaiDayStart(now);

  /*
     The weights as the nightly ranking used them, not as they sit in the row.

     `weightsForBrowse` is what a category listing runs on — there is no query
     box on one, so the relevance weight is put through the mode staff chose on
     board 12c rather than left multiplying zero. Storing the untransformed row
     would make state 09 fire on a *buyer's* query shape rather than on a staff
     decision, and miss a change to the browse mode, which is a staff decision.
  */
  const [stored, mode, boosts] = await Promise.all([
    liveWeights(),
    liveBrowseRelevanceMode(),
    liveBoosts(now),
  ]);
  const weights = weightsForBrowse(stored, mode);

  const rows = await prisma.business.findMany({
    where: PUBLIC_BUSINESS,
    select: {
      id: true,
      primaryCategoryId: true,
      verificationTier: true,
      responseTimeMedianMs: true,
      specCompleteness: true,
      plan: { select: { rankingMultiplier: true } },
      categories: { select: { categoryId: true } },
      locations: { where: { published: true }, select: { emirate: true } },
    },
    take: MAX_LISTINGS + 1,
  });

  const capped = rows.length > MAX_LISTINGS;
  const listings = capped ? rows.slice(0, MAX_LISTINGS) : rows;

  const candidates: Candidate[] = listings.map((row) => {
    const signals = {
      // The primary-category value. See the note at the top of this file.
      relevance: 1,
      verificationTier: row.verificationTier,
      responseTimeMedianMs: row.responseTimeMedianMs,
      specCompleteness: row.specCompleteness,
      /*
         A nightly ranking has no buyer, so it has no origin and no distance.

         Null rather than zero, and the ranker already scores an unknown
         distance as half credit: not knowing where somebody is must not read
         as evidence that they are inconvenient. It also means the distance
         weight contributes the same constant to every listing here, so it
         moves nobody — which is the truth about a page nobody is looking at.
      */
      distanceKm: null,
      planMultiplier: row.plan?.rankingMultiplier ?? 1,
      boostPoints: boosts.get(row.id) ?? 0,
    };

    return {
      id: row.id,
      primaryCategoryId: row.primaryCategoryId,
      categoryIds: [
        ...new Set([row.primaryCategoryId, ...row.categories.map((link) => link.categoryId)]),
      ],
      emirates: [...new Set(row.locations.map((location) => location.emirate))],
      score: scoreRow(signals, weights),
      factors: {
        scores: factorScores(signals),
        raw: {
          relevance: 1,
          verificationTier: row.verificationTier,
          responseTimeMedianMs: row.responseTimeMedianMs,
          specCompleteness: row.specCompleteness,
          distanceKm: null,
          planMultiplier: row.plan?.rankingMultiplier ?? 1,
        },
      },
    };
  });

  await writeFactorDays(candidates, weights, boosts, day);

  /*
     The scopes with supply.

     A category always gets its country-wide listing. It gains an emirate
     listing only where one of its own published businesses has a branch there,
     so the fan-out is the directory's shape rather than the enum's.
  */
  const byCategory = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    for (const categoryId of candidate.categoryIds) {
      const bucket = byCategory.get(categoryId);
      if (bucket) bucket.push(candidate);
      else byCategory.set(categoryId, [candidate]);
    }
  }

  let scopes = 0;
  let ranks = 0;

  for (const [categoryId, members] of byCategory) {
    /*
       Sorted once per category, then filtered per scope.

       An emirate listing is a subset of the country-wide one in the same order,
       so re-sorting per scope would be the same comparison run eight times. The
       positions are one-based over whatever the filter left.
    */
    const ordered = [...members].sort((a, b) => b.score - a.score);

    scopes += 1;
    ranks += await writeRanks(categoryId, null, ordered, day);

    const emirates = new Set(members.flatMap((member) => member.emirates));
    for (const emirate of emirates) {
      const inEmirate = ordered.filter((member) => member.emirates.includes(emirate));
      if (inEmirate.length === 0) continue;
      scopes += 1;
      ranks += await writeRanks(categoryId, emirate, inEmirate, day);
    }
  }

  return {
    day,
    listings: candidates.length,
    scopes,
    ranks,
    // Only ever non-empty above `MAX_LISTINGS`, and then it names the shortfall
    // rather than the categories — the listings past the cap were never read, so
    // which categories they belonged to is not something this run knows.
    skipped: capped ? [`${rows.length - MAX_LISTINGS}+ listings past MAX_LISTINGS`] : [],
    ranAt: now,
  };
}

/**
 * One factor row per listing per day.
 *
 * `ON CONFLICT` on the composite key rather than `skipDuplicates`, so a second
 * run on the same day corrects the row instead of leaving the first attempt's
 * numbers standing. The job is idempotent by day, which is what makes it safe
 * to re-run after a failed night.
 */
async function writeFactorDays(
  candidates: readonly Candidate[],
  weights: RankingWeights,
  boosts: ReadonlyMap<string, number>,
  day: Date,
): Promise<void> {
  const weightsJson = JSON.stringify(weights);

  for (let index = 0; index < candidates.length; index += CHUNK) {
    const chunk = candidates.slice(index, index + CHUNK);
    const ids = chunk.map((candidate) => candidate.id);
    const scores = chunk.map((candidate) => JSON.stringify(candidate.factors.scores));
    const raw = chunk.map((candidate) => JSON.stringify(candidate.factors.raw));
    const points = chunk.map((candidate) => boosts.get(candidate.id) ?? 0);

    await prisma.$executeRaw`
      INSERT INTO "listing_factor_day" ("business_id", "day", "scores", "raw", "weights", "boost_points")
      SELECT id, ${day}::date, s::jsonb, r::jsonb, ${weightsJson}::jsonb, p
        FROM unnest(${ids}::text[], ${scores}::text[], ${raw}::text[], ${points}::int[])
             AS t(id, s, r, p)
      ON CONFLICT ("business_id", "day") DO UPDATE
        SET "scores" = EXCLUDED."scores",
            "raw" = EXCLUDED."raw",
            "weights" = EXCLUDED."weights",
            "boost_points" = EXCLUDED."boost_points"
    `;
  }
}

/**
 * The ranked scope, written one-based.
 *
 * `total` is the size of *this* scope, so `#3 of 5` on a country-wide listing
 * and `#1 of 2` on the Dubai one are both true of the same night. The `ON
 * CONFLICT` target names the matching partial index, for the reason the
 * migration sets out: `emirate` is nullable, it belongs in the identity, and a
 * null never equals a null.
 */
async function writeRanks(
  categoryId: string,
  emirate: Emirate | null,
  ordered: readonly Candidate[],
  day: Date,
): Promise<number> {
  const total = ordered.length;

  for (let index = 0; index < ordered.length; index += CHUNK) {
    const chunk = ordered.slice(index, index + CHUNK);
    const ids = chunk.map((candidate) => candidate.id);
    const positions = chunk.map((_candidate, offset) => index + offset + 1);

    const rows = Prisma.sql`
      SELECT ${Prisma.raw("gen_random_uuid()::text")}, id, ${categoryId}, ${emirate}::"emirate",
             ${day}::date, position, ${total}
        FROM unnest(${ids}::text[], ${positions}::int[]) AS t(id, position)
    `;

    if (emirate === null) {
      await prisma.$executeRaw`
        INSERT INTO "category_rank_day" ("id", "business_id", "category_id", "emirate", "day", "position", "total")
        ${rows}
        ON CONFLICT ("business_id", "category_id", "day") WHERE "emirate" IS NULL DO UPDATE
          SET "position" = EXCLUDED."position", "total" = EXCLUDED."total"
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO "category_rank_day" ("id", "business_id", "category_id", "emirate", "day", "position", "total")
        ${rows}
        ON CONFLICT ("business_id", "category_id", "day", "emirate") WHERE "emirate" IS NOT NULL DO UPDATE
          SET "position" = EXCLUDED."position", "total" = EXCLUDED."total"
      `;
    }
  }

  return total;
}
