import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { businessPredicateSql, tokensOf } from "@/lib/search/predicate-sql";
import { scoreSql, type ScoreColumns } from "@/lib/search/score-sql";
import {
  mergeByBand,
  placeSponsored,
  RANKING_KINDS,
  relevanceBand,
  type RankingKind,
  type VectorSet,
} from "@/lib/search/ranking";
import type { SearchQuery } from "@/lib/search/query";
import { resolveTradeKind, type TradeKindRow } from "@/lib/taxonomy/trade-kind";

/**
 * Task T2.2 — the ranked page, ordered and paged in Postgres.
 *
 * ## What was wrong
 *
 * `searchBusinesses` read `take: 200` with **no `orderBy`**, scored those two
 * hundred in the process, sorted them, and sliced the requested page out of the
 * result — under a total that came from a real `count()` of the whole match. So
 * at 41,000 listings:
 *
 *   · the two hundred were whichever two hundred Postgres returned, which is
 *     not a sample of the best two hundred and is not stable between requests;
 *   · the ranking ordered that arbitrary sample, so the first page was the best
 *     of an accident rather than the best of the directory;
 *   · and page eleven onwards was **empty** beneath a total claiming 1,935
 *     pages, because the slice ran off the end of the window.
 *
 * ## What this does
 *
 * One statement per vector: the predicate, the score, `ORDER BY score DESC, id`
 * and a `LIMIT` sized to the requested page. Postgres returns ids; the caller
 * fetches the page's rows.
 *
 * The score is `lib/search/score-sql.ts`, which mirrors `factorScores`
 * arithmetic-for-arithmetic and is held to it by `score-sql-parity.test.ts`.
 * The predicate is `lib/search/predicate-sql.ts`, held to `businessWhere`
 * id-for-id by `predicate-sql-parity.test.ts`. Those two tests are what make a
 * second implementation safe enough to have.
 *
 * ## Why the merge is still in the process, and why that is exact
 *
 * `rankBlended` never compares a goods score with a services score. Each kind
 * is ranked on its own vector and the two orders are merged by relevance band,
 * and inside a band by the Sainte-Laguë quotient. That merge is sequential —
 * what it takes next depends on how many it has taken from each group so far —
 * and band is not monotonic within a group, so it is **not** expressible as an
 * `ORDER BY`.
 *
 * It does not have to be. The merge only ever consumes from the head of a
 * group, so producing the first *M* output rows consumes at most *M* rows from
 * any one group. Take *M* from each group and merge, and the result is the true
 * first *M* — exactly, not approximately. *M* is `page × pageSize`, so the
 * window is bounded by how deep the buyer has paged rather than by the size of
 * the directory.
 *
 * With one vector live — which is every page in production today, because no
 * services vector has ever been published — there is one group, the merge is
 * the identity, and the window is one page plus the sponsored slot.
 *
 * ## The one case that falls back
 *
 * `listingKind` picks a listing's vector from the *matched* category when the
 * page's scope does not contain the listing's primary one, and the match is
 * `categories.find(…)` over a relation read with no `orderBy` — so which
 * category wins is not defined. Where a scope spans both kinds this is
 * unanswerable in SQL without inventing an order the process does not have, so
 * this returns null and the caller keeps its in-process path. No surface does
 * that today: search passes no scope, and a landing page passes one subtree.
 */

/** Rows per page, and the hard ceiling on how deep the window may go. */
export const MAX_PAGE_WINDOW = 2_000;

export interface RankedPage {
  /** The page's business ids, in rank order. */
  ids: string[];
  /**
   * True when the window could not reach the requested page.
   *
   * At `MAX_PAGE_WINDOW` the honest answer is that the ranking does not order
   * that deep, not an empty page under a total of thirty-eight thousand. The
   * caller says so on screen — the same doctrine `lib/search/directory.ts`
   * applies to `MAX_LISTINGS`: every caller reports the shortfall.
   */
  capped: boolean;
  /** The sponsored id, if it is on this page after placement. */
  sponsoredId: string | null;
}

export interface RankedPageInput {
  query: SearchQuery;
  categoryIds?: readonly string[];
  /** Board 12c's stored vectors. `services` is null until one is published. */
  vectors: VectorSet;
  /** Resolved kind per category id, for the vector each listing ranks on. */
  kinds: ReadonlyMap<string, TradeKindRow>;
  /** Live boosts, added after the weighted sum exactly as `scoreRow` adds them. */
  boosts: ReadonlyMap<string, number>;
  /** The buyer's origin, for the distance factor. Null is unknown, not far. */
  origin: { lat: number; lng: number } | null;
  page: number;
  pageSize: number;
  /** Fetched on top of the page, so the sponsored row can be lifted into it. */
  sponsoredId: string | null;
  now?: Date;
}

/**
 * `relevanceOf`, as SQL.
 *
 * `0.35 + 0.65 × share of words hit`, one for an exact match of the whole
 * surface, and a half when there is nothing typed. `position(token in
 * haystack)` rather than `LIKE`, because `relevanceOf` uses
 * `String.includes` — a literal substring, where `LIKE` would read `_` as a
 * wildcard. The predicate's own `ILIKE` branches are a different question and
 * are documented there.
 */
function relevanceSql(q: string): Prisma.Sql {
  const words = tokensOf(q);
  if (words.length === 0) return Prisma.sql`0.5`;

  const haystack = Prisma.sql`lower(b.display_name || ' ' || coalesce(b.search_text, ''))`;
  const hits = Prisma.join(
    words.map((word) => Prisma.sql`(CASE WHEN position(${word} IN ${haystack}) > 0 THEN 1 ELSE 0 END)`),
    " + ",
  );
  return Prisma.sql`CASE
    WHEN ${haystack} = ${q.trim().toLowerCase()} THEN 1.0
    ELSE 0.35 + 0.65 * ((${hits})::double precision / ${words.length})
  END`;
}

/**
 * Kilometres to the nearest *measurable* branch, or null.
 *
 * `measurable()` counts an exact pin and nothing else, because an approximate
 * pin is the area's centroid and the kilometres it yields are the distance to
 * the area dressed up as the distance to the address. The haversine is the one
 * in `lib/geo`, written out here: a supplier with no exact pin has no position,
 * and unknown scores as unknown rather than as far.
 */
function distanceJoin(origin: { lat: number; lng: number } | null): Prisma.Sql | null {
  if (!origin) return null;
  return Prisma.sql`LEFT JOIN LATERAL (
    SELECT MIN(
      6371 * 2 * asin(sqrt(
        power(sin(radians(l.lat - ${origin.lat}) / 2), 2)
        + cos(radians(${origin.lat})) * cos(radians(l.lat))
        * power(sin(radians(l.lng - ${origin.lng}) / 2), 2)
      ))
    ) AS km
    FROM location l
    WHERE l.business_id = b.id
      AND l.published = true
      AND l.geocode_precision = 'exact'
      AND l.lat IS NOT NULL AND l.lng IS NOT NULL
  ) dist ON true`;
}

/**
 * The share of a listing's live services that hold all six required fields —
 * the services vector's fourth slot, measured exactly as spec completeness is.
 *
 * Null with no live service, which scores as unknown rather than as empty. A
 * lateral rather than a correlated subquery, and only joined for the services
 * vector: the first draft put it inline and Postgres evaluated it per row
 * before the `LIMIT` could discard any, which is how a scale fix becomes a
 * scale defect.
 *
 * The six are `REQUIRED_FIELDS` — name, engagement type, fee basis,
 * turnaround, delivered where, deliverable. Not `scope`, which is the one field
 * a first draft of this guessed at, and `ranking-services.test.ts` caught it
 * with `column s.engagement does not exist` rather than with a wrong number.
 * `scopeCompleteness` rounds to two places and so does this, because a share
 * that agrees to fifteen places and disagrees at two is still a different
 * ranking.
 */
const SCOPE_JOIN = Prisma.sql`LEFT JOIN LATERAL (
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE round((count(*) FILTER (
                WHERE btrim(coalesce(s.name, '')) <> ''
                  AND s.engagement_type IS NOT NULL
                  AND btrim(coalesce(s.fee_basis, '')) <> ''
                  AND btrim(coalesce(s.turnaround, '')) <> ''
                  AND s.delivered_where IS NOT NULL
                  AND btrim(coalesce(s.deliverable, '')) <> ''
              )::numeric / count(*)), 2)::double precision
         END AS share
  FROM service s
  WHERE s.business_id = b.id AND s.status = 'live'
) scope ON true`;

/**
 * A boost map, as a joined table rather than a scalar subquery.
 *
 * `(VALUES …)` correlated on `b.id` is evaluated per row; joined once it is a
 * hash join. The same mistake as the category map below, and the same fix.
 */
function boostsJoin(boosts: ReadonlyMap<string, number>): Prisma.Sql | null {
  if (boosts.size === 0) return null;
  const rows = Prisma.join(
    [...boosts].map(([id, points]) => Prisma.sql`(${id}, ${points}::double precision)`),
    ", ",
  );
  return Prisma.sql`LEFT JOIN (VALUES ${rows}) AS boost(id, points) ON boost.id = b.id`;
}

/**
 * The vector a listing ranks on — `listingKind`, for the cases SQL can answer.
 *
 * The resolved kind per category travels as a joined table rather than a walk
 * of the tree in SQL: the taxonomy is hundreds of rows, `resolveTradeKind`
 * already walks it in the process behind one cached read, and a tree whose
 * inheritance changes then moves both paths at once.
 *
 * **Joined, not correlated.** The first draft wrote it as
 * `(SELECT kind FROM (VALUES …) WHERE id = b.primary_category_id)` inside both
 * the score and the `WHERE`, which Postgres evaluated per matched row against a
 * five-hundred-row `VALUES` list — and that, not the lateral joins, was where
 * the 1,400 ms went. `pnpm measure:search` found it; reading the query did not.
 *
 * Null where SQL cannot answer: a scope spanning both kinds makes the choice
 * depend on `categories.find`'s undefined order.
 */
function vectorParts(
  kinds: ReadonlyMap<string, TradeKindRow>,
  categoryIds: readonly string[] | undefined,
): { join: Prisma.Sql; expr: Prisma.Sql } | null {
  const resolved = (id: string) => resolveTradeKind(kinds, id);

  const map = Prisma.join(
    [...kinds.keys()].map((id) => Prisma.sql`(${id}, ${resolved(id)})`),
    ", ",
  );
  const join = Prisma.sql`LEFT JOIN (VALUES ${map}) AS k(id, kind) ON k.id = b.primary_category_id`;
  const kindOfPrimary = Prisma.sql`COALESCE(k.kind, 'goods')`;

  if (!categoryIds?.length) return { join, expr: kindOfPrimary };

  const scopeKinds = new Set(categoryIds.map(resolved));
  if (scopeKinds.size !== 1) return null;

  const uniform = [...scopeKinds][0]!;
  const ids = Prisma.join(categoryIds.map((id) => Prisma.sql`${id}`), ", ");
  return {
    join,
    expr: Prisma.sql`CASE
      WHEN b.primary_category_id IN (${ids}) THEN ${kindOfPrimary}
      ELSE ${uniform}
    END`,
  };
}

async function windowFor(
  input: RankedPageInput,
  vector: RankingKind,
  parts: { join: Prisma.Sql; expr: Prisma.Sql },
  limit: number,
  /**
   * False while no services vector is published, and then there is one window.
   *
   * `appliedVector` is the rule: a services listing ranks on the **goods**
   * vector until a services one exists. Partitioning by the listing's own kind
   * instead dropped every services-category listing out of the result — caught
   * by `search-page-order.test.ts`, which compared the page against the whole
   * matched set ranked in the process and found rows missing rather than
   * misordered.
   */
  partition: boolean,
): Promise<{ id: string; score: number; relevance: number }[]> {
  const weights = vector === "services" ? input.vectors.services : input.vectors.goods;
  if (!weights) return [];

  const relevance = relevanceSql(input.query.q);
  const services = vector === "services";
  const distance = distanceJoin(input.origin);

  /*
     Joins, not correlated subqueries, and only the ones this vector reads.

     The first draft wrote the plan multiplier, the distance and the scope
     share as scalar subqueries inside the score. Postgres evaluated all three
     for every matched row before the `LIMIT` could discard any, and the empty
     query — 38,687 rows — went from 19 ms to 1,408 ms. Measured, not guessed:
     `pnpm measure:search`. A scale fix that is ten times slower than the defect
     it replaces is not a fix.
  */
  const columns: ScoreColumns = {
    relevance,
    verificationTier: Prisma.sql`b.verification_tier`,
    responseTimeMedianMs: Prisma.sql`b.response_time_median_ms`,
    specCompleteness: Prisma.sql`b.spec_completeness`,
    scopeCompleteness: services ? Prisma.sql`scope.share` : Prisma.sql`NULL::double precision`,
    distanceKm: distance ? Prisma.sql`dist.km` : Prisma.sql`NULL::double precision`,
    // Null, and deliberately: a per-service coverage match is a document-level
    // reading that `lib/search/blended.ts` owns, and it scores as unknown here
    // exactly as it does in the process path when no place is named.
    coverageMatch: Prisma.sql`NULL::boolean`,
    planMultiplier: Prisma.sql`pl.ranking_multiplier`,
  };

  const predicate = businessPredicateSql(input.query, input.categoryIds, input.now);
  const boosts = boostsJoin(input.boosts);
  const score = Prisma.sql`(${scoreSql(columns, weights, vector)}) + ${
    boosts ? Prisma.sql`COALESCE(boost.points, 0)` : Prisma.sql`0`
  }`;

  const joins: Prisma.Sql[] = [
    Prisma.sql`LEFT JOIN plan pl ON pl.id = b.plan_id`,
    parts.join,
  ];
  if (boosts) joins.push(boosts);
  if (distance) joins.push(distance);
  if (services) joins.push(SCOPE_JOIN);

  return prisma.$queryRaw<{ id: string; score: number; relevance: number }[]>(Prisma.sql`
    SELECT b.id, (${score}) AS score, (${relevance}) AS relevance
    FROM business b
    ${Prisma.join(joins, " ")}
    WHERE ${predicate}${partition ? Prisma.sql` AND (${parts.expr}) = ${vector}` : Prisma.empty}
    ORDER BY score DESC, b.id ASC
    LIMIT ${limit}
  `);
}

/**
 * The buyer's three single-signal sorts, as an `ORDER BY`.
 *
 * `orderFor` applies these over the candidates: unclaimed listings sink in
 * every order — criterion 7, because a "newest" sort that floated a licence
 * import above a claimed supplier would be worse than useless — and nulls go
 * last within each group whichever way the signal points.
 *
 * Null where the sort is the ranking itself, which is `best` and an absent
 * value alike.
 */
function sortSql(sort: SearchQuery["sort"]): Prisma.Sql | null {
  if (sort !== "rating" && sort !== "reply" && sort !== "newest") return null;
  const claimed = Prisma.sql`(CASE WHEN b.claim_status = 'claimed' THEN 0 ELSE 1 END) ASC`;
  const signal =
    sort === "rating"
      ? Prisma.sql`b.rating_overall DESC NULLS LAST`
      : sort === "reply"
        ? Prisma.sql`b.response_time_median_ms ASC NULLS LAST`
        : Prisma.sql`b.published_at DESC NULLS LAST`;
  return Prisma.sql`${claimed}, ${signal}, b.id ASC`;
}

/**
 * The page, ordered in Postgres.
 *
 * Returns null where SQL cannot answer faithfully, which today is only the
 * mixed-kind scope described in this module's docblock. The total is not
 * returned: the caller counts with `businessWhere`, which is what every chip
 * and facet on the page counts with, and a second count here would be a second
 * number for one question.
 */
export async function rankedPage(input: RankedPageInput): Promise<RankedPage | null> {
  const parts = vectorParts(input.kinds, input.categoryIds);
  if (!parts) return null;

  const from = (input.page - 1) * input.pageSize;
  const predicate = businessPredicateSql(input.query, input.categoryIds, input.now);

  /*
     A single-signal sort does not touch the score, so it pages properly with
     `OFFSET` and no window at all. Today these sorts were ordered over the same
     arbitrary two hundred rows as the ranking, so "Fastest reply" on page two
     answered with nothing.
  */
  const columnSort = sortSql(input.query.sort);
  if (columnSort) {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT b.id FROM business b
      WHERE ${predicate}
      ORDER BY ${columnSort}
      LIMIT ${input.pageSize} OFFSET ${from}
    `);
    return { ids: rows.map((row) => row.id), capped: false, sponsoredId: null };
  }

  const deep = input.page * input.pageSize;
  const capped = deep > MAX_PAGE_WINDOW;
  /*
     One row of slack beyond the page. `placeSponsored` lifts one row to the
     front, and without the slack that would push one off the end of the page.
  */
  const window = Math.min(deep + 1, MAX_PAGE_WINDOW);

  const live = RANKING_KINDS.filter(
    (kind) => (kind === "services" ? input.vectors.services : input.vectors.goods) !== null,
  );

  /*
     One ordered window per live vector, and the merge over them is exact for
     the first `window` positions — see this module's docblock for why taking
     `M` from each group is enough to produce the true first `M`.
  */
  const windows = await Promise.all(
    live.map((kind) => windowFor(input, kind, parts, window, live.length > 1)),
  );
  const ordered = windows.length <= 1 ? (windows[0] ?? []) : mergeByBand(windows, (row) => relevanceBand(row.relevance));

  const placed = placeSponsored(
    ordered,
    input.sponsoredId,
    (row) => row.id,
    Boolean(input.query.tier),
  );

  return {
    ids: placed.rows.slice(from, from + input.pageSize).map((row) => row.id),
    capped,
    sponsoredId: placed.sponsoredId,
  };
}
