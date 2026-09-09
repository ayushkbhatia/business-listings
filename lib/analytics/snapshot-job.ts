import "server-only";
import { Prisma, type Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { dubaiDayStart } from "@/lib/format";
import { weightsForBrowse, type RankingWeights } from "@/lib/search/ranking";
import { liveBoosts } from "@/lib/search/boosts";
import {
  candidatesFrom,
  loadDirectory,
  MAX_LISTINGS,
  scopesOf,
  type Candidate,
} from "@/lib/search/directory";
import { liveBrowseRelevanceMode, liveWeights } from "@/lib/search/settings";

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

/** Re-exported: the cap belongs to the sampler, and callers assert on it. */
export { MAX_LISTINGS } from "@/lib/search/directory";

/** Rows per `INSERT`. Postgres takes far more; this keeps a statement legible. */
const CHUNK = 500;

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

  /*
     The same sampler board 12c's impact preview runs — `lib/search/directory.ts`,
     which loads the directory once and ranks it under a vector. Board 12c `B5`:
     *one job, two readers, do not build a second sampler*. Two implementations
     of "where does this listing sit in this category" is how the preview comes
     to promise a reorder the night then does not perform.
  */
  const { rows, capped, unread } = await loadDirectory();
  const candidates = candidatesFrom(rows, weights, boosts);

  await writeFactorDays(candidates, weights, boosts, day);

  let scopes = 0;
  let ranks = 0;
  for (const scope of scopesOf(candidates)) {
    scopes += 1;
    ranks += await writeRanks(scope.categoryId, scope.emirate, scope.ordered, day);
  }

  return {
    day,
    listings: candidates.length,
    scopes,
    ranks,
    // Only ever non-empty above `MAX_LISTINGS`, and then it names the shortfall
    // rather than the categories — the listings past the cap were never read, so
    // which categories they belonged to is not something this run knows.
    skipped: capped ? [`${unread}+ listings past MAX_LISTINGS`] : [],
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
    const scores = chunk.map((candidate) => JSON.stringify(candidate.scores));
    const raw = chunk.map((candidate) => JSON.stringify(candidate.raw));
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
