import "server-only";
import type { Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { WEIGHT_KEYS, type WeightKey } from "@/lib/search/ranking";
import { attribute, decompose, type Attribution, type FactorDay } from "./attribution";
import { placeChange, windowFor, type Delta } from "./model";

/**
 * The amendment's read — board `3a`'s card, switched on.
 *
 * `CategoryPositionDay` has had a writer and no reader since board `3l`
 * shipped: its own schema comment calls it *"the one board `3a`'s card reads"*,
 * and `3a` never read it. This is that reader, over `CategoryRankDay` — the
 * nightly snapshot, which is true on a day nobody browsed — with the impression
 * counter used for the one thing only a real buyer can tell us: which scope of a
 * category buyers actually use.
 *
 * ## Three kinds of absence, and they say different things
 *
 * `no comparison yet` is a rank with no history. `Not ranked` is history with no
 * rank — the listing is not in that scope's set today. `Not measured` is
 * neither, and it names the last night we did rank the category rather than
 * shrugging. Collapsing any two of them tells a seller something untrue, which
 * is why they are three states and not one empty cell.
 */

/** How many rows the overview card carries before it defers to analytics. */
export const CARD_ROWS = 3;

/** Where a listing sits in one category listing, and why it moved. */
export interface PositionRow {
  categoryId: string;
  /** The label — `Cold rooms · UAE`. Built by the caller from the two parts. */
  categoryName: string;
  /** Null is the country-wide listing. */
  emirate: Emirate | null;
  /** Null in both absence states; `state` says which one. */
  rank: number | null;
  total: number | null;
  movement: Delta;
  reason: Attribution;
  state: "ranked" | "not_ranked" | "not_measured";
  /** State 06 only: the last night this scope was ranked at all. */
  lastMeasured: Date | null;
}

export interface PositionCard {
  rows: PositionRow[];
  /** Categories the listing ranks in beyond the three shown. Never padded. */
  more: number;
  /** The window both numbers were read over, so the header can name it. */
  days: number;
}

/**
 * The card.
 *
 * Ordered primary category first, then by the impressions buyers actually
 * generated — a seller reads their own trade first, and after that the row that
 * matters is the one people look at.
 */
export async function positionCard(
  businessId: string,
  now: Date = new Date(),
): Promise<PositionCard> {
  const window = windowFor(now);

  const [business, impressions, latestRun] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        primaryCategoryId: true,
        categories: { select: { categoryId: true } },
        locations: { where: { published: true }, select: { emirate: true } },
      },
    }),
    /*
       Which scope of each category buyers use, from the counter.

       This is the one question `CategoryPositionDay` answers better than the
       snapshot: a Dubai supplier in Cold rooms may be browsed country-wide and
       in Valves may be browsed filtered to Dubai, and only impressions know
       which. The snapshot supplies the number; this supplies which number.
    */
    prisma.categoryPositionDay.groupBy({
      by: ["categoryId", "emirate"],
      where: { businessId, day: { gte: window.from } },
      _sum: { impressions: true },
    }),
    prisma.categoryRankDay.aggregate({ _max: { day: true } }),
  ]);

  if (!business) return { rows: [], more: 0, days: window.days };

  const ownEmirates = [...new Set(business.locations.map((location) => location.emirate))];
  const preferred = new Map<string, Emirate | null>();
  const browsed = new Map<string, number>();
  for (const row of impressions) {
    const seen = row._sum.impressions ?? 0;
    const best = browsed.get(row.categoryId) ?? -1;
    if (seen > best) {
      browsed.set(row.categoryId, seen);
      preferred.set(row.categoryId, row.emirate);
    }
  }

  const categoryIds = [
    ...new Set([business.primaryCategoryId, ...business.categories.map((link) => link.categoryId)]),
  ];

  /*
     Scope per category: what buyers browse, else the seller's own emirate where
     they have exactly one, else the country-wide listing. A supplier with
     branches in three emirates has no single local scope, and picking one of
     them would be the card choosing which of their branches counts.
  */
  const scopeOf = (categoryId: string): Emirate | null =>
    preferred.get(categoryId) ?? (ownEmirates.length === 1 ? (ownEmirates[0] ?? null) : null);

  const scopes = categoryIds.map((categoryId) => ({
    categoryId,
    emirate: scopeOf(categoryId),
  }));

  const [snapshots, categories] = await Promise.all([
    prisma.categoryRankDay.findMany({
      where: {
        businessId,
        day: { gte: window.from },
        OR: scopes.map((scope) => ({ categoryId: scope.categoryId, emirate: scope.emirate })),
      },
      orderBy: { day: "asc" },
      select: { categoryId: true, emirate: true, day: true, position: true, total: true },
    }),
    prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    }),
  ]);

  const named = new Map(categories.map((category) => [category.id, category.name]));
  const lastRun = latestRun._max.day;

  const byScope = new Map<string, typeof snapshots>();
  for (const row of snapshots) {
    const key = `${row.categoryId}:${row.emirate ?? ""}`;
    const bucket = byScope.get(key);
    if (bucket) bucket.push(row);
    else byScope.set(key, [row]);
  }

  const rows: PositionRow[] = [];
  for (const scope of scopes) {
    const series = byScope.get(`${scope.categoryId}:${scope.emirate ?? ""}`) ?? [];
    const first = series.at(0) ?? null;
    const latest = series.at(-1) ?? null;

    /*
       State 06. We have never ranked this scope inside the window, so we do not
       know where they are — which is a different sentence from "you are not in
       the results", and it must not borrow that one's rendering.
    */
    if (!latest) {
      rows.push({
        categoryId: scope.categoryId,
        categoryName: named.get(scope.categoryId) ?? scope.categoryId,
        emirate: scope.emirate,
        rank: null,
        total: null,
        movement: { kind: "none" },
        reason: { kind: "none" },
        state: "not_measured",
        lastMeasured: lastRun,
      });
      continue;
    }

    /*
       State 05. The job ran last night and this listing was not in the set —
       the category link went, or the branch in that emirate did. They have
       history and no rank, which is the absence the other two are not.
    */
    if (lastRun && latest.day.getTime() < lastRun.getTime()) {
      rows.push({
        categoryId: scope.categoryId,
        categoryName: named.get(scope.categoryId) ?? scope.categoryId,
        emirate: scope.emirate,
        rank: null,
        total: null,
        movement: { kind: "none" },
        reason: { kind: "none" },
        state: "not_ranked",
        lastMeasured: latest.day,
      });
      continue;
    }

    rows.push({
      categoryId: scope.categoryId,
      categoryName: named.get(scope.categoryId) ?? scope.categoryId,
      emirate: scope.emirate,
      rank: latest.position,
      total: latest.total,
      // Against the first snapshot inside the window, never against yesterday.
      // Changing the window changes the arrow, and the window is named on both
      // surfaces so that it can.
      movement: placeChange(latest.position, first === latest ? null : (first?.position ?? null)),
      reason: await reasonFor({
        businessId,
        categoryId: scope.categoryId,
        emirate: scope.emirate,
        from: first === latest ? null : (first?.day ?? null),
        to: latest.day,
        positionBefore: first === latest ? null : (first?.position ?? null),
        positionAfter: latest.position,
      }),
      state: "ranked",
      lastMeasured: latest.day,
    });
  }

  const ordered = rows.sort((a, b) => {
    if (a.categoryId === business.primaryCategoryId) return -1;
    if (b.categoryId === business.primaryCategoryId) return 1;
    const seen = (browsed.get(b.categoryId) ?? 0) - (browsed.get(a.categoryId) ?? 0);
    return seen !== 0 ? seen : a.categoryId.localeCompare(b.categoryId);
  });

  return {
    rows: ordered.slice(0, CARD_ROWS),
    more: Math.max(0, ordered.length - CARD_ROWS),
    days: window.days,
  };
}


/**
 * The same sentence, for a phrase a buyer typed.
 *
 * Board `3l`'s panel and board `3a`'s card carry two different numbers and one
 * component, and this is the half of that which is not shared: the *scope* of a
 * query rank is a phrase, so who overtook whom comes from `SearchImpressionDay`
 * rather than from the nightly category snapshot. Everything after that — the
 * decomposition, the six states, the refusal to blame a seller for a weight
 * somebody else moved — is the one implementation in `attribution.ts`.
 */
export async function queryReason(input: {
  businessId: string;
  normalised: string;
  from: Date | null;
  to: Date;
  positionBefore: number | null;
  positionAfter: number | null;
}): Promise<Attribution> {
  if (!input.from || input.positionBefore === null || input.positionAfter === null) {
    return { kind: "none" };
  }

  const [before, after, earliest] = await Promise.all([
    factorDay(input.businessId, input.from),
    factorDay(input.businessId, input.to),
    prisma.listingFactorDay.aggregate({
      where: { businessId: input.businessId },
      _min: { day: true },
    }),
  ]);
  if (!after) return { kind: "none" };

  return attribute({
    before,
    after,
    positionBefore: input.positionBefore,
    positionAfter: input.positionAfter,
    historyStarts: earliest._min.day ?? input.from,
    on: input.to,
    /*
       No boost branch here, deliberately.

       A boost is points on a listing and it moves every ranking that listing
       appears in — but state 10 names the *category* it was bought for, because
       that is what board 12c's form asks staff to record. Claiming a phrase was
       boosted would be inventing a scope nobody bought.
    */
    boostEndedOn: null,
    overtakenBy: before
      ? await overtookOnQuery(input.normalised, input.from, input.to, input.positionBefore, input.positionAfter)
      : null,
  });
}

/** Who passed this listing on one phrase. A count and a factor, never a name. */
async function overtookOnQuery(
  normalised: string,
  from: Date,
  to: Date,
  positionBefore: number,
  positionAfter: number,
): Promise<{ count: number; factor: WeightKey } | null> {
  if (positionAfter <= positionBefore) return null;

  const [was, now] = await Promise.all([
    prisma.searchImpressionDay.findMany({
      where: { normalised, day: from, bestRank: { gt: positionBefore } },
      select: { businessId: true },
    }),
    prisma.searchImpressionDay.findMany({
      where: { normalised, day: to, bestRank: { lt: positionAfter } },
      select: { businessId: true },
    }),
  ]);

  const below = new Set(was.map((row) => row.businessId));
  const passed = now.map((row) => row.businessId).filter((id) => below.has(id));
  if (passed.length === 0) return null;

  return improvedMost(passed, from, to);
}

interface ReasonInput {
  businessId: string;
  categoryId: string;
  emirate: Emirate | null;
  from: Date | null;
  to: Date;
  positionBefore: number | null;
  positionAfter: number;
}

/**
 * The sentence under one row, or the absence of one.
 *
 * Every branch reads history rather than inferring from the movement itself.
 * Inferring is how the old screen billed a staff weight change to the seller:
 * the position fell, the only story available was the seller's, so the seller
 * got the story.
 */
async function reasonFor(input: ReasonInput): Promise<Attribution> {
  if (!input.from || input.positionBefore === null) return { kind: "none" };

  const [before, after, earliest, endedBoost] = await Promise.all([
    factorDay(input.businessId, input.from),
    factorDay(input.businessId, input.to),
    prisma.listingFactorDay.aggregate({
      where: { businessId: input.businessId },
      _min: { day: true },
    }),
    /*
       A boost that expired inside the window.

       `ListingBoost` rows are kept rather than deleted when they lapse, which
       is what makes this answerable at all — board 12c requires a reason and an
       expiry on every one, so both halves of the sentence exist.
    */
    prisma.listingBoost.findFirst({
      where: {
        businessId: input.businessId,
        expiresAt: { gte: input.from, lte: input.to },
      },
      orderBy: { expiresAt: "desc" },
      select: { expiresAt: true, createdAt: true },
    }),
  ]);

  if (!after) return { kind: "none" };

  return attribute({
    before,
    after,
    positionBefore: input.positionBefore,
    positionAfter: input.positionAfter,
    historyStarts: earliest._min.day ?? input.from,
    on: input.to,
    boostEndedOn: endedBoost?.expiresAt ?? null,
    earnedRank: endedBoost
      ? await earnedRankBefore(input, endedBoost.createdAt)
      : null,
    overtakenBy: before
      ? await overtakenBy(input, input.positionBefore, input.positionAfter)
      : null,
  });
}

/** One day's vector, or null where the night has no row. */
async function factorDay(businessId: string, day: Date): Promise<FactorDay | null> {
  const row = await prisma.listingFactorDay.findUnique({
    where: { businessId_day: { businessId, day } },
    select: { scores: true, raw: true, weights: true, boostPoints: true },
  });
  return row ? asFactorDay(row) : null;
}

/**
 * Where this listing sat the night before its boost began.
 *
 * Null where the boost predates the nightly job, and the sentence is written to
 * survive that: *"Your paid boost ended on 30 Aug"* is worth saying with or
 * without the second half, because silence lets a seller mourn a position they
 * never earned.
 */
async function earnedRankBefore(input: ReasonInput, boostStarted: Date): Promise<number | null> {
  const row = await prisma.categoryRankDay.findFirst({
    where: {
      businessId: input.businessId,
      categoryId: input.categoryId,
      emirate: input.emirate,
      day: { lt: boostStarted },
    },
    orderBy: { day: "desc" },
    select: { position: true },
  });
  return row?.position ?? null;
}

/**
 * Who passed this listing, as a count and a factor. Never as a name.
 *
 * The only state that reads another business's history, and it reads it in
 * aggregate: how many listings came from below to above, and which factor they
 * improved most between the same two nights. A competitor is never named to a
 * seller, on any surface — that would turn a directory into a scoreboard and
 * make every listing's own measurements public through the back door.
 */
async function overtakenBy(
  input: ReasonInput,
  positionBefore: number,
  positionAfter: number,
): Promise<{ count: number; factor: WeightKey } | null> {
  if (positionAfter <= positionBefore || !input.from) return null;

  const scope = { categoryId: input.categoryId, emirate: input.emirate };
  const [was, now] = await Promise.all([
    prisma.categoryRankDay.findMany({
      where: { ...scope, day: input.from, position: { gt: positionBefore } },
      select: { businessId: true },
    }),
    prisma.categoryRankDay.findMany({
      where: { ...scope, day: input.to, position: { lt: positionAfter } },
      select: { businessId: true },
    }),
  ]);

  const below = new Set(was.map((row) => row.businessId));
  const passed = now.map((row) => row.businessId).filter((id) => below.has(id));
  if (passed.length === 0) return null;

  return improvedMost(passed, input.from, input.to);
}

/**
 * What a group of listings improved most between two nights.
 *
 * Only their own doing is counted — `decompose` splits a weight change out
 * before this sees it, so a staff slider that lifted everybody cannot be
 * reported to one seller as somebody else's effort.
 */
async function improvedMost(
  businessIds: readonly string[],
  from: Date,
  to: Date,
): Promise<{ count: number; factor: WeightKey } | null> {
  const [beforeRows, afterRows] = await Promise.all([
    prisma.listingFactorDay.findMany({
      where: { businessId: { in: [...businessIds] }, day: from },
      select: { businessId: true, scores: true, raw: true, weights: true, boostPoints: true },
    }),
    prisma.listingFactorDay.findMany({
      where: { businessId: { in: [...businessIds] }, day: to },
      select: { businessId: true, scores: true, raw: true, weights: true, boostPoints: true },
    }),
  ]);

  const later = new Map(afterRows.map((row) => [row.businessId, row]));
  const gained = Object.fromEntries(WEIGHT_KEYS.map((key) => [key, 0])) as Record<
    WeightKey,
    number
  >;

  for (const row of beforeRows) {
    const pair = later.get(row.businessId);
    if (!pair) continue;
    const start = asFactorDay(row);
    const end = asFactorDay(pair);
    if (!start || !end) continue;
    const parts = decompose(start, end);
    for (const key of WEIGHT_KEYS) gained[key] += Math.max(0, parts.byFactor[key]);
  }

  const factor = WEIGHT_KEYS.reduce((best, key) => (gained[key] > gained[best] ? key : best));
  // Nobody improved anything measurable — they rose because this listing fell,
  // which is a different sentence and not one this state gets to claim.
  if (gained[factor] <= 0) return null;

  return { count: businessIds.length, factor };
}

/**
 * A stored row, read back as vectors — or null where it is not one.
 *
 * The column is JSONB with a check that it holds an object, which is as far as
 * Postgres can go. A row missing a factor would otherwise reach the arithmetic
 * as `undefined`, and the seller would be told their measured reply time rose
 * to `NaN`. A day we cannot read is a day we do not have, which the states
 * above already render honestly.
 */
function asFactorDay(row: {
  scores: unknown;
  raw: unknown;
  weights: unknown;
  boostPoints: number;
}): FactorDay | null {
  const scores = numbersByFactor(row.scores);
  const weights = numbersByFactor(row.weights);
  if (!scores || !weights || typeof row.raw !== "object" || row.raw === null) return null;
  return { scores, weights, raw: row.raw as FactorDay["raw"], boostPoints: row.boostPoints };
}

/** Every weight key present and finite, or nothing. */
function numbersByFactor(value: unknown): Record<WeightKey, number> | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  const out = {} as Record<WeightKey, number>;
  for (const key of WEIGHT_KEYS) {
    const entry = source[key];
    if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
    out[key] = entry;
  }
  return out;
}
