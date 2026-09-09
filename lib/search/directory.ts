import "server-only";
import type { Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { PUBLIC_BUSINESS } from "@/lib/db/queries/search";
import {
  factorScores,
  scoreRow,
  type FactorScores,
  type RankingWeights,
} from "./ranking";

/**
 * The whole directory, ranked under a weights vector, with no query.
 *
 * Two readers and one sampler. The nightly snapshot (`lib/analytics/snapshot-job.ts`)
 * writes what it finds; board `12c`'s impact preview runs it twice — once on
 * the live weights and once on the draft — and diffs the two. Board `12c` `B5`
 * asks for exactly that: *one job, two readers — do not build a second sampler*.
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
 */

export interface DirectoryRow {
  id: string;
  primaryCategoryId: string;
  verificationTier: number;
  responseTimeMedianMs: number | null;
  specCompleteness: number | null;
  plan: { rankingMultiplier: number } | null;
  categories: { categoryId: string }[];
  locations: { emirate: Emirate }[];
}

export interface Candidate {
  id: string;
  primaryCategoryId: string;
  categoryIds: string[];
  emirates: Emirate[];
  score: number;
  scores: FactorScores;
  /** What the ranker was handed, before it was scored. */
  raw: RawSignals;
  boostPoints: number;
}

/**
 * The unscored signals, as `ListingFactorDay.raw` stores them.
 *
 * Structurally `RawFactors` in `lib/analytics/attribution`, and deliberately
 * declared here rather than imported: this module is the one that reads them
 * off a row, and a ranking module that imports its shape from the reporting
 * layer has the dependency the wrong way round.
 */
export interface RawSignals {
  relevance: number | null;
  verificationTier: number;
  responseTimeMedianMs: number | null;
  specCompleteness: number | null;
  distanceKm: number | null;
  planMultiplier: number;
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

export async function loadDirectory(): Promise<DirectoryLoad> {
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
  return {
    rows: capped ? rows.slice(0, MAX_LISTINGS) : rows,
    capped,
    unread: capped ? rows.length - MAX_LISTINGS : 0,
  };
}

/** The signals a no-query ranking sees. Shared so the two readers cannot differ. */
export function signalsOf(row: DirectoryRow, boostPoints: number) {
  return {
    // The primary-category value. See the note at the top of this file.
    relevance: 1,
    verificationTier: row.verificationTier,
    responseTimeMedianMs: row.responseTimeMedianMs,
    specCompleteness: row.specCompleteness,
    distanceKm: null,
    planMultiplier: row.plan?.rankingMultiplier ?? 1,
    boostPoints,
  };
}

export function candidatesFrom(
  rows: readonly DirectoryRow[],
  weights: RankingWeights,
  boosts: ReadonlyMap<string, number>,
): Candidate[] {
  return rows.map((row) => {
    const boostPoints = boosts.get(row.id) ?? 0;
    const signals = signalsOf(row, boostPoints);
    return {
      id: row.id,
      primaryCategoryId: row.primaryCategoryId,
      categoryIds: [
        ...new Set([row.primaryCategoryId, ...row.categories.map((link) => link.categoryId)]),
      ],
      emirates: [...new Set(row.locations.map((location) => location.emirate))],
      score: scoreRow(signals, weights),
      scores: factorScores(signals),
      raw: {
        relevance: signals.relevance,
        verificationTier: signals.verificationTier,
        responseTimeMedianMs: signals.responseTimeMedianMs,
        specCompleteness: signals.specCompleteness,
        distanceKm: signals.distanceKm,
        planMultiplier: signals.planMultiplier,
      },
      boostPoints,
    };
  });
}

export interface Scope {
  categoryId: string;
  /** Null is the country-wide listing, which every category gets. */
  emirate: Emirate | null;
  /** Ranked, best first. One-based positions are the index plus one. */
  ordered: Candidate[];
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
 * Each category is sorted once and filtered per scope: an emirate listing is a
 * subset of the country-wide one in the same order, so re-sorting per scope
 * would run one comparison eight times.
 */
export function scopesOf(candidates: readonly Candidate[]): Scope[] {
  const byCategory = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    for (const categoryId of candidate.categoryIds) {
      const bucket = byCategory.get(categoryId);
      if (bucket) bucket.push(candidate);
      else byCategory.set(categoryId, [candidate]);
    }
  }

  const scopes: Scope[] = [];
  for (const [categoryId, members] of byCategory) {
    const ordered = [...members].sort((a, b) => b.score - a.score);
    scopes.push({ categoryId, emirate: null, ordered });

    const emirates = new Set(members.flatMap((member) => member.emirates));
    for (const emirate of emirates) {
      const inEmirate = ordered.filter((member) => member.emirates.includes(emirate));
      if (inEmirate.length === 0) continue;
      scopes.push({ categoryId, emirate, ordered: inEmirate });
    }
  }
  return scopes;
}

/** `categoryId` plus the emirate, or the empty string for country-wide. */
export function scopeKey(categoryId: string, emirate: Emirate | null): string {
  return `${categoryId}:${emirate ?? ""}`;
}
