import "server-only";
import { prisma } from "@/lib/db/client";
import { loadTradeKinds } from "@/lib/taxonomy/service";
import { resolveTradeKind } from "@/lib/taxonomy/trade-kind";
import { liveBoosts } from "./boosts";
import {
  candidatesFrom,
  loadDirectory,
  scopeKey,
  scopesOf,
  type Placed,
} from "./directory";
import {
  WEIGHT_KEYS,
  weightsForBrowse,
  type BrowseRelevanceMode,
  type RankingKind,
  type RankingWeights,
  type VectorSet,
  type WeightKey,
} from "./ranking";
import { t } from "@/lib/i18n";
import type { Emirate } from "@/lib/db/generated/client";

/**
 * Board `12c` §2 — what publishing would change.
 *
 * `Preview on a query` was not enough, and the first render only had that. It
 * tests one phrase; a weight change is a platform-wide reorder, and the question
 * before publishing is not *what happens to this query* but *which categories
 * move and who falls*. 128 listings moving in HVAC is a statistic. Skyline Air
 * Systems falling nine places is a phone call.
 *
 * The run is the nightly sampler, twice — once on the live vectors and once with
 * the draft swapped in for its own kind — over the same directory rows and the
 * same boosts, so the only thing that differs between the two rankings is the
 * thing being previewed. Both go through `weightsForBrowse`, because a category
 * listing has no query box: previewing the raw weights would show a reorder no
 * page performs, and would miss a browse-mode change entirely.
 *
 * ## Scoped to the vector — board `12c-s` B7
 *
 * Unscoped, a services publish claimed to have told 30,000 parts suppliers.
 * Here it cannot: the sampler ranks each scope on its own category's vector, so
 * swapping the services draft in moves only services scopes, and every count
 * below — listings, categories, sellers, memberships — is counted from the
 * scopes that moved. No filter enforces it; there is nothing to filter.
 *
 * The one case that looks like leakage is not. **Before a services vector is
 * published, services scopes rank on the goods vector**, so a goods draft moves
 * them too, and the preview says so — that is what publishing it would do.
 */

export interface ImpactRow {
  categoryId: string;
  categoryName: string;
  emirate: Emirate | null;
  /** Localised, e.g. `HVAC · Dubai` or `Cold rooms · UAE`. */
  scopeLabel: string;
  /** The vector this scope ranks on after the publish — what `gains` is named in. */
  vector: RankingKind;
  /** Listings whose position in this scope changes. */
  moving: number;
  /** Listings ranked in this scope at all. */
  total: number;
  /** The largest single fall, by business. Null where nothing falls. */
  biggestFall: { businessId: string; name: string; places: number } | null;
  /**
   * The factor that separates the risers from the fallers, where one does.
   * Null reads as *no material change* — measured, not a shrug.
   */
  gains: WeightKey | null;
}

export interface ImpactPreview {
  /** Which vector's draft this previews. */
  kind: RankingKind;
  rows: ImpactRow[];
  /** Distinct listings that move anywhere. */
  listingsMoved: number;
  /** Distinct categories with any movement. */
  categoriesMoved: number;
  /**
   * The most sellers who can see the note, which is everyone who moves.
   *
   * The spec put the category's whole membership on the button — 431 sellers
   * across four moved categories — on the reading that state 09 says *"this
   * affected every listing in the category"*. The shipped attribution does not
   * work that way: `attribute()` returns no reason at all when a position did
   * not change, so a seller who held their place is told nothing however much
   * the category moved around them.
   *
   * So the button states the movers and says *up to*: it is an upper bound
   * rather than a promise, because state 09 also has to beat the seller's own
   * drift before it is the sentence chosen. A label claiming 431 where 180 can
   * possibly see it would be the board's own biggest number being its least
   * true one.
   */
  sellersTold: number;
  /**
   * Distinct businesses holding a listing in an affected category.
   *
   * Not the button's number — see above — but the scope the disclosure
   * describes, and what the panel beside it states.
   */
  sellersInScope: number;
  /**
   * `(category, business)` memberships across the affected categories.
   *
   * Carried so the board can never render a count above a shorter list:
   * `sellersTold` ≤ `sellersInScope` ≤ this, and all three are asserted in the
   * tests rather than left to a reviewer's eye.
   */
  scopedListings: number;
  /** Listings past `MAX_LISTINGS`, named rather than silently dropped. */
  unread: number;
  ranAt: string;
}

/**
 * How much average factor score has to separate risers from fallers before the
 * board will name a cohort.
 *
 * In points of the 100-point scale. Below this the honest answer is that the
 * reorder was not about any one factor, and *no material change* is a truer row
 * than a factor name picked because its number was fractionally the largest.
 */
const NAMEABLE_GAIN = 0.5;

/**
 * `HVAC · Dubai`, or `Cold rooms · UAE` for the country-wide listing.
 *
 * The country-wide scope is named rather than left blank: a row reading only
 * *Cold rooms* beside three rows carrying an emirate reads as an omission, and
 * a buyer browsing the whole country is a real scope rather than missing data.
 */
function scopeLabelOf(categoryName: string, emirate: Emirate | null): string {
  return t("ranking.impact.scope", {
    category: categoryName,
    scope: emirate ? t(`emirate.${emirate}` as never) : t("ranking.impact.countrywide"),
  });
}

function meanScore(rows: readonly Placed[], key: WeightKey): number {
  if (rows.length === 0) return 0;
  return rows.reduce((total, row) => total + row.scores[key], 0) / rows.length;
}

/**
 * Who gains, derived rather than asserted.
 *
 * For each factor: how much weight it gained, times how much better the risers
 * score on it than the fallers. A factor whose weight did not move cannot
 * explain a reorder however well one group scores on it, and a factor both
 * groups score identically on cannot explain one however much weight it gained.
 * The product is the only thing that means anything, and the largest wins.
 */
function gainsOf(
  risers: readonly Placed[],
  fallers: readonly Placed[],
  weightDelta: Record<WeightKey, number>,
): WeightKey | null {
  if (risers.length === 0 || fallers.length === 0) return null;

  let best: WeightKey | null = null;
  let bestSize = 0;
  for (const key of WEIGHT_KEYS) {
    const separation = meanScore(risers, key) - meanScore(fallers, key);
    const size = weightDelta[key] * separation;
    if (size > bestSize) {
      bestSize = size;
      best = key;
    }
  }
  return bestSize >= NAMEABLE_GAIN ? best : null;
}

function positionsOf(ordered: readonly Placed[]): Map<string, number> {
  const positions = new Map<string, number>();
  ordered.forEach((placed, index) => positions.set(placed.candidate.id, index + 1));
  return positions;
}

export interface ImpactInput {
  /** The vector the draft belongs to. The other one is held at its live value. */
  kind: RankingKind;
  draft: RankingWeights;
  draftMode: BrowseRelevanceMode;
  /** Both live vectors and their modes, as `liveVectors()` returns them. */
  live: VectorSet & { modes: Record<RankingKind, BrowseRelevanceMode | null> };
}

/** The live pair, as a page with no query ranks on it. */
function browseSet(live: ImpactInput["live"]): VectorSet {
  return {
    goods: weightsForBrowse(live.goods, live.modes.goods ?? undefined),
    services: live.services
      ? weightsForBrowse(live.services, live.modes.services ?? undefined)
      : null,
  };
}

export async function runImpact(input: ImpactInput, now = new Date()): Promise<ImpactPreview> {
  const [{ rows, unread }, boosts, kinds] = await Promise.all([
    loadDirectory(),
    liveBoosts(now),
    loadTradeKinds(),
  ]);

  const liveSet = browseSet(input.live);
  const draftVector = weightsForBrowse(input.draft, input.draftMode);
  const draftSet: VectorSet =
    input.kind === "goods"
      ? { goods: draftVector, services: liveSet.services }
      : { goods: liveSet.goods, services: draftVector };

  const candidates = candidatesFrom(rows, boosts);
  const liveScopes = scopesOf(candidates, { vectors: liveSet, kinds });
  const draftScopes = scopesOf(candidates, { vectors: draftSet, kinds });
  const draftByKey = new Map(
    draftScopes.map((scope) => [scopeKey(scope.categoryId, scope.emirate), scope]),
  );

  const movedBusinesses = new Set<string>();
  const movedCategories = new Set<string>();

  /** A row before the two name lookups it needs. */
  interface RawRow {
    categoryId: string;
    emirate: Emirate | null;
    vector: RankingKind;
    moving: number;
    total: number;
    fall: { businessId: string; places: number } | null;
    gains: WeightKey | null;
  }
  const raw: RawRow[] = [];

  const weightsOf = (set: VectorSet, vector: RankingKind) =>
    vector === "services" && set.services ? set.services : set.goods;

  for (const before of liveScopes) {
    const after = draftByKey.get(scopeKey(before.categoryId, before.emirate));
    if (!after) continue;

    const wasAt = positionsOf(before.ordered);
    const nowAt = positionsOf(after.ordered);

    const risers: Placed[] = [];
    const fallers: Placed[] = [];
    let biggestFall: { businessId: string; places: number } | null = null;
    let moving = 0;

    for (const placed of after.ordered) {
      const id = placed.candidate.id;
      const from = wasAt.get(id);
      const to = nowAt.get(id);
      if (from === undefined || to === undefined) continue;
      const places = to - from;
      if (places === 0) continue;

      moving += 1;
      movedBusinesses.add(id);
      if (places < 0) risers.push(placed);
      else {
        fallers.push(placed);
        if (!biggestFall || places > biggestFall.places) {
          biggestFall = { businessId: id, places };
        }
      }
    }

    if (moving === 0) continue;
    movedCategories.add(before.categoryId);

    const beforeWeights = weightsOf(liveSet, before.vector);
    const afterWeights = weightsOf(draftSet, after.vector);
    const weightDelta = Object.fromEntries(
      WEIGHT_KEYS.map((key) => [key, afterWeights[key] - beforeWeights[key]]),
    ) as Record<WeightKey, number>;

    raw.push({
      categoryId: before.categoryId,
      emirate: before.emirate,
      vector: after.vector,
      moving,
      total: before.ordered.length,
      fall: biggestFall,
      gains: gainsOf(risers, fallers, weightDelta),
    });
  }

  // Ordered by listings moved. A category where nothing moves is not listed —
  // padding a table to fill a grid is the one thing this project will not do.
  raw.sort((a, b) => b.moving - a.moving);

  const categoryIds = [...new Set(raw.map((row) => row.categoryId))];
  const fallerIds = [
    ...new Set(raw.map((row) => row.fall?.businessId).filter((id): id is string => id !== undefined)),
  ];

  const [categories, fallers, membership] = await Promise.all([
    prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    }),
    fallerIds.length > 0
      ? prisma.business.findMany({
          where: { id: { in: fallerIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([]),
    scopedMembership([...movedCategories]),
  ]);

  const categoryName = new Map(categories.map((row) => [row.id, row.name]));
  const fallerName = new Map(fallers.map((row) => [row.id, row.displayName]));

  const rowsOut: ImpactRow[] = raw.map((row) => {
    const name = categoryName.get(row.categoryId) ?? row.categoryId;
    return {
      categoryId: row.categoryId,
      categoryName: name,
      emirate: row.emirate,
      scopeLabel: scopeLabelOf(name, row.emirate),
      vector: row.vector,
      moving: row.moving,
      total: row.total,
      biggestFall: row.fall
        ? {
            businessId: row.fall.businessId,
            name: fallerName.get(row.fall.businessId) ?? row.fall.businessId,
            places: row.fall.places,
          }
        : null,
      gains: row.gains,
    };
  });

  return {
    kind: input.kind,
    rows: rowsOut,
    listingsMoved: movedBusinesses.size,
    categoriesMoved: movedCategories.size,
    sellersTold: movedBusinesses.size,
    sellersInScope: membership.sellers,
    scopedListings: membership.memberships,
    unread,
    ranAt: now.toISOString(),
  };
}

/**
 * Every seller the disclosure reaches, and the memberships it is scoped to.
 *
 * A business in two affected categories is two memberships and one seller,
 * which is why the two numbers differ and why the smaller can never exceed the
 * larger. The button states the seller count; the invariant is what stops it
 * being a count over a shorter list.
 *
 * Scoped to the vector by the categories it is handed: only categories whose
 * scopes moved reach here, and a scope only moves on the vector being previewed.
 */
async function scopedMembership(
  categoryIds: readonly string[],
): Promise<{ sellers: number; memberships: number }> {
  if (categoryIds.length === 0) return { sellers: 0, memberships: 0 };

  const members = await prisma.business.findMany({
    where: {
      OR: [
        { primaryCategoryId: { in: [...categoryIds] } },
        { categories: { some: { categoryId: { in: [...categoryIds] } } } },
      ],
    },
    select: {
      id: true,
      primaryCategoryId: true,
      categories: { select: { categoryId: true } },
    },
  });

  const wanted = new Set(categoryIds);
  let memberships = 0;
  for (const member of members) {
    const trades = new Set([
      member.primaryCategoryId,
      ...member.categories.map((link) => link.categoryId),
    ]);
    for (const trade of trades) if (wanted.has(trade)) memberships += 1;
  }

  return { sellers: members.length, memberships };
}

/**
 * How many published listings each vector reaches, by primary category.
 *
 * The publishing panel's numbers. *"Reorders services results only"* is a claim
 * the board argues; these make it a statement about this directory rather than a
 * sentence about a design. By primary category because that is the one kind a
 * listing has outside a category page — on a category page the page decides,
 * and a listing in both kinds is counted once here, where it is filed first.
 *
 * `servicesMeasured` is how many of the services listings hold a live service,
 * which is how many have a scope completeness at all. The rest score it as
 * unknown, and the panel says how many that is rather than letting the wired
 * gate imply the measurement covers everybody.
 */
export async function vectorReach(): Promise<{
  services: number;
  goods: number;
  servicesMeasured: number;
}> {
  const [kinds, businesses] = await Promise.all([
    loadTradeKinds(),
    prisma.business.findMany({
      where: { suspendedAt: null, publishedAt: { not: null } },
      select: {
        primaryCategoryId: true,
        _count: { select: { services: { where: { status: "live" } } } },
      },
    }),
  ]);

  let services = 0;
  let goods = 0;
  let servicesMeasured = 0;
  for (const business of businesses) {
    const kind = resolveTradeKind(kinds, business.primaryCategoryId);
    if (kind === "services") {
      services += 1;
      if (business._count.services > 0) servicesMeasured += 1;
    } else {
      goods += 1;
    }
  }
  return { services, goods, servicesMeasured };
}
