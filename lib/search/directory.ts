import "server-only";
import type { Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { PUBLIC_BUSINESS } from "@/lib/db/queries/search";
import type { CoverageScope } from "@/lib/locations/coverage";
import { resolveTradeKind, type TradeKindRow } from "@/lib/taxonomy/trade-kind";
import {
  appliedVector,
  factorScores,
  scoreRow,
  type FactorScores,
  type RankingKind,
  type RankingWeights,
  type RankSignals,
  type VectorSet,
} from "./ranking";
import {
  coverageMatch,
  scopeCompleteness,
  type RankableService,
} from "./service-signals";

/**
 * The whole directory, ranked under a pair of vectors, with no query.
 *
 * Two readers and one sampler. The nightly snapshot (`lib/analytics/snapshot-job.ts`)
 * writes what it finds; board `12c`'s impact preview runs it twice — once on
 * the live vectors and once with the draft swapped in — and diffs the two. Board
 * `12c` `B5` asks for exactly that: *one job, two readers — do not build a second
 * sampler*.
 *
 * It lives in `lib/search` rather than in `lib/analytics` because it is a
 * property of the ranking, not of the reporting, and because the preview is a
 * search concern that the analytics job happens to share.
 *
 * ## What a nightly ranking cannot know
 *
 * There is no buyer, so there is no origin and no distance: `distanceKm` is
 * null and the ranker scores an unknown distance at half credit. Not knowing
 * where somebody is must not read as evidence that they are inconvenient, and
 * the constant contributes the same amount to every listing, so it moves
 * nobody. On a category listing `relevance` is category-match depth and is
 * therefore a property of the *pair* rather than of the listing; the primary
 * category's value is used, which is 1.
 *
 * ## Which vector a scope ranks on — board `12c-s`
 *
 * **The scope's category decides**, through `Category.tradeKind` (B11). Every
 * listing in the HVAC-maintenance listing is ranked as a services listing there,
 * whatever else it sells, and the same business in the HVAC-equipment listing is
 * ranked as goods. So a scope never mixes vectors, and a services publish cannot
 * move a single goods position — B7 and B8, by construction rather than by care.
 *
 * An emirate is the one place the sampler *does* know something: the scope names
 * a place. On a services scope that makes coverage match a real yes or no, so
 * the emirate listing is scored for its own emirate rather than filtered out of
 * the country-wide order.
 */

export interface DirectoryService extends RankableService {
  name: string | null;
}

export interface DirectoryRow {
  id: string;
  primaryCategoryId: string;
  verificationTier: number;
  responseTimeMedianMs: number | null;
  specCompleteness: number | null;
  plan: { rankingMultiplier: number } | null;
  categories: { categoryId: string }[];
  locations: { emirate: Emirate }[];
  /** Live services only. A draft has no page for a buyer to have compared. */
  services: DirectoryService[];
  /** The business default — `service_coverage` rows with no service. */
  coverageDefault: CoverageScope[];
}

export interface Candidate {
  id: string;
  primaryCategoryId: string;
  categoryIds: string[];
  emirates: Emirate[];
  boostPoints: number;
  row: DirectoryRow;
}

/**
 * One listing, scored for one scope.
 *
 * What used to be carried on the candidate itself. It moved here because a
 * listing's score is no longer a property of the listing: the vector depends on
 * the scope's category, and on a services scope coverage match depends on the
 * scope's emirate.
 */
export interface Placed {
  candidate: Candidate;
  vector: RankingKind;
  score: number;
  scores: FactorScores;
  /** What the ranker was handed, before it was scored. */
  raw: RawSignals;
}

/**
 * The unscored signals, as `ListingFactorDay.raw` stores them.
 *
 * Structurally `RawFactors` in `lib/analytics/attribution`, and deliberately
 * declared here rather than imported: this module is the one that reads them
 * off a row, and a ranking module that imports its shape from the reporting
 * layer has the dependency the wrong way round.
 *
 * `scopeCompleteness` and `coverageMatch` are set on every row and read only on
 * the services vector, so a seller's sentence can quote the measure their slot
 * actually scored.
 */
export interface RawSignals {
  relevance: number | null;
  verificationTier: number;
  responseTimeMedianMs: number | null;
  specCompleteness: number | null;
  distanceKm: number | null;
  planMultiplier: number;
  scopeCompleteness: number | null;
  /** 1 yes, 0 no, null unknown — JSON has no tri-state boolean worth trusting. */
  coverageMatch: number | null;
}

/**
 * How many listings one run will rank.
 *
 * Not a page size — the whole directory goes through this in memory, once, and
 * the ranking itself is arithmetic over six numbers. The cap exists so that a
 * bulk import cannot turn a nightly job into an overnight one without anybody
 * noticing, and every caller reports the shortfall rather than swallowing it.
 */
export const MAX_LISTINGS = 20_000;

export interface DirectoryLoad {
  rows: DirectoryRow[];
  /** True where the directory is larger than `MAX_LISTINGS`. Never silent. */
  capped: boolean;
  /** How many listings were not read. Zero unless `capped`. */
  unread: number;
}

/**
 * Every ranked listing, and an honest count of the ones that did not fit.
 *
 * ## `unread` used to be the number 1, wearing a query's clothes
 *
 * The read took `MAX_LISTINGS + 1` and reported `rows.length - MAX_LISTINGS`,
 * which is **1 whenever it is non-zero** — at 20,001 listings and at 200,000
 * alike. `ImpactTable` prints it to an ops lead as *"1 past the sampling cap
 * were not ranked"* immediately before they press publish, so the one number on
 * that panel meant to convey scale conveyed none, and did it on a decision
 * surface.
 *
 * A `count` beside the read gives the real figure. It is a second query on a
 * path that already pulls twenty thousand rows into memory, and the alternative
 * is a constant on a screen whose whole job is to say how much a change moves —
 * `CLAUDE.md`: *every number is a query, not a constant.*
 *
 * The `+ 1` is gone with it. The cap is what `take` should say.
 */
export async function loadDirectory(): Promise<DirectoryLoad> {
  const found = await prisma.business.findMany({
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
      /*
         Board `12c-s`. The six required fields and each live service's own
         coverage, because scope completeness is computed on read (`3g-s` B3)
         and coverage match resolves per service (B4). A services listing with
         neither scores both as unknown, which is what it was before.
      */
      services: {
        where: { status: "live" },
        select: {
          name: true,
          categoryId: true,
          engagementType: true,
          feeBasis: true,
          turnaround: true,
          deliveredWhere: true,
          deliverable: true,
          coverage: { select: { emirate: true, areaId: true } },
        },
      },
      serviceCoverage: { where: { serviceId: null }, select: { emirate: true, areaId: true } },
    },
    take: MAX_LISTINGS,
  });

  const rows: DirectoryRow[] = found.map(({ serviceCoverage, ...row }) => ({
    ...row,
    coverageDefault: serviceCoverage,
  }));

  /*
     Only where the read filled the cap. Below it there is nothing beyond the
     page and the count would be a round trip to learn what `rows.length`
     already said.
  */
  const capped = rows.length === MAX_LISTINGS;
  const total = capped ? await prisma.business.count({ where: PUBLIC_BUSINESS }) : rows.length;

  return {
    rows,
    capped: total > MAX_LISTINGS,
    unread: Math.max(0, total - MAX_LISTINGS),
  };
}

export function candidatesFrom(
  rows: readonly DirectoryRow[],
  boosts: ReadonlyMap<string, number>,
): Candidate[] {
  return rows.map((row) => ({
    id: row.id,
    primaryCategoryId: row.primaryCategoryId,
    categoryIds: [
      ...new Set([row.primaryCategoryId, ...row.categories.map((link) => link.categoryId)]),
    ],
    emirates: [...new Set(row.locations.map((location) => location.emirate))],
    boostPoints: boosts.get(row.id) ?? 0,
    row,
  }));
}

/**
 * What the sampler ranks with: the vectors, already put through
 * `weightsForBrowse`, and the taxonomy that says which applies where.
 */
export interface RankingContext {
  vectors: VectorSet;
  kinds: ReadonlyMap<string, TradeKindRow>;
}

/**
 * A category and everything filed under it, from the loaded taxonomy.
 *
 * A service is filed under a subcategory and the listing it ranks in may be the
 * parent's. Matching only the exact id would find no service on a sector page
 * and fall back to the business default for every firm on it.
 */
export function descendantsIndex(
  kinds: ReadonlyMap<string, TradeKindRow>,
): (categoryId: string) => string[] {
  const children = new Map<string, string[]>();
  for (const row of kinds.values()) {
    if (!row.parentId) continue;
    const list = children.get(row.parentId);
    if (list) list.push(row.id);
    else children.set(row.parentId, [row.id]);
  }

  const memo = new Map<string, string[]>();
  return (categoryId) => {
    const hit = memo.get(categoryId);
    if (hit) return hit;
    const out: string[] = [];
    const stack = [categoryId];
    // Bounded by the taxonomy's own size, so a cycle cannot spin for ever.
    while (stack.length > 0 && out.length <= kinds.size) {
      const next = stack.pop()!;
      out.push(next);
      for (const child of children.get(next) ?? []) stack.push(child);
    }
    memo.set(categoryId, out);
    return out;
  };
}

/** The signals a no-query ranking sees. Shared so the two readers cannot differ. */
export function signalsOf(
  row: DirectoryRow,
  boostPoints: number,
  services: { categoryIds: readonly string[]; emirate: Emirate | null },
): RankSignals {
  const wanted = new Set(services.categoryIds);
  return {
    // The primary-category value. See the note at the top of this file.
    relevance: 1,
    verificationTier: row.verificationTier,
    responseTimeMedianMs: row.responseTimeMedianMs,
    specCompleteness: row.specCompleteness,
    distanceKm: null,
    planMultiplier: row.plan?.rankingMultiplier ?? 1,
    scopeCompleteness: scopeCompleteness(row.services),
    coverageMatch: coverageMatch({
      target: services.emirate ? { emirate: services.emirate, areaId: null } : null,
      businessDefault: row.coverageDefault,
      matched: row.services.filter((service) => wanted.has(service.categoryId)),
    }),
    boostPoints,
  };
}

/** Score one candidate for one `(category, emirate)` scope. */
export function placeIn(
  candidate: Candidate,
  categoryId: string,
  emirate: Emirate | null,
  context: RankingContext & { descendants: (categoryId: string) => string[] },
): Placed {
  const kind = resolveTradeKind(context.kinds, categoryId);
  const vector = appliedVector(kind, context.vectors.services !== null);
  const weights: RankingWeights =
    vector === "services" ? context.vectors.services! : context.vectors.goods;

  const signals = signalsOf(candidate.row, candidate.boostPoints, {
    categoryIds: context.descendants(categoryId),
    emirate,
  });

  return {
    candidate,
    vector,
    score: scoreRow(signals, weights, vector),
    scores: factorScores(signals, vector),
    raw: {
      relevance: signals.relevance,
      verificationTier: signals.verificationTier,
      responseTimeMedianMs: signals.responseTimeMedianMs,
      specCompleteness: signals.specCompleteness,
      distanceKm: signals.distanceKm,
      planMultiplier: signals.planMultiplier,
      scopeCompleteness: signals.scopeCompleteness ?? null,
      coverageMatch:
        signals.coverageMatch === null || signals.coverageMatch === undefined
          ? null
          : signals.coverageMatch
            ? 1
            : 0,
    },
  };
}

export interface Scope {
  categoryId: string;
  /** Null is the country-wide listing, which every category gets. */
  emirate: Emirate | null;
  /** The one vector every listing in this scope ranked on. */
  vector: RankingKind;
  /** Ranked, best first. One-based positions are the index plus one. */
  ordered: Placed[];
}

/**
 * The scopes with supply, ranked.
 *
 * Seven emirates and a country-wide scope over every category would be eight
 * rankings per category for scopes with nobody in them. Every category gets its
 * country-wide listing and gains an emirate listing only where a published
 * business in that category actually has a branch there, so the fan-out is the
 * directory's shape rather than the enum's.
 *
 * On the goods vector each category is sorted once and filtered per scope: an
 * emirate listing is a subset of the country-wide one in the same order, so
 * re-sorting per scope would run one comparison eight times. On the services
 * vector it is not a subset in the same order — coverage match is a yes or no
 * for *this* emirate — so each emirate listing is scored for itself.
 *
 * Membership stays the branch rule on both vectors. It is what the live landing
 * pages filter by (`businessWhere`), and a seller told they rank #3 in Sharjah on
 * a page that does not list them would be told a position nobody can see.
 */
export function scopesOf(candidates: readonly Candidate[], context: RankingContext): Scope[] {
  const descendants = descendantsIndex(context.kinds);
  const ctx = { ...context, descendants };

  const byCategory = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    for (const categoryId of candidate.categoryIds) {
      const bucket = byCategory.get(categoryId);
      if (bucket) bucket.push(candidate);
      else byCategory.set(categoryId, [candidate]);
    }
  }

  const byScore = (a: Placed, b: Placed) => b.score - a.score;
  const scopes: Scope[] = [];
  for (const [categoryId, members] of byCategory) {
    const ordered = members.map((member) => placeIn(member, categoryId, null, ctx)).sort(byScore);
    const vector = ordered[0]?.vector ?? "goods";
    scopes.push({ categoryId, emirate: null, vector, ordered });

    const emirates = new Set(members.flatMap((member) => member.emirates));
    for (const emirate of emirates) {
      const inEmirate =
        vector === "services"
          ? members
              .filter((member) => member.emirates.includes(emirate))
              .map((member) => placeIn(member, categoryId, emirate, ctx))
              .sort(byScore)
          : ordered.filter((placed) => placed.candidate.emirates.includes(emirate));
      if (inEmirate.length === 0) continue;
      scopes.push({ categoryId, emirate, vector, ordered: inEmirate });
    }
  }
  return scopes;
}

/** `categoryId` plus the emirate, or the empty string for country-wide. */
export function scopeKey(categoryId: string, emirate: Emirate | null): string {
  return `${categoryId}:${emirate ?? ""}`;
}
