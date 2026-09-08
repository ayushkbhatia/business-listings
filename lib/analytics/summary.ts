import "server-only";
import type { Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { assertCanReadAnalytics } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { analyticsScopeFor, type AnalyticsScope } from "@/lib/auth/subject";
import { dubaiDayStart } from "@/lib/format";
import { queryReason } from "./position";
import type { Attribution } from "./attribution";
import {
  funnel,
  medianIsShowable,
  percentChange,
  placeChange,
  pointChange,
  shares,
  windowFor,
  NO_COMPARISON,
  type Delta,
  type FunnelStage,
  type ShareRow,
  type StageCounts,
  type Window,
} from "./model";

/**
 * Board `3l`, read once.
 *
 * Four panels, one window, and every figure a query. The board's second rule is
 * that this page has to be **worth the click from `3a`** — whose shipped card
 * already carries a position, a movement and a cause — so a page that showed
 * position alone would send a seller backwards.
 *
 * ## Nothing here is estimated
 *
 * Every count comes from a rollup written by `./record` or from a transactional
 * table. Where a source started after the window opened, the panel says
 * `tracking since` rather than showing a rise from zero that is really the
 * pipeline switching on. That is the honest reading of a funnel whose first
 * three stages could not be backfilled.
 */

/** A day in milliseconds. Asia/Dubai has no daylight saving, so this is exact. */
const DAY_MS = 86_400_000;

export interface QueryRow {
  /** As buyers typed it, normalised. What the panel renders. */
  query: string;
  volume: number;
  /** Best position held in the window. Null is *not ranked*, not a bad rank. */
  position: number | null;
  /**
   * How many listings the query returned. Null on a row written before the
   * amendment gave the table a denominator — those show their rank alone
   * rather than borrowing a count from a later day.
   */
  total: number | null;
  movement: Delta;
  /**
   * Why it moved, attached to this row rather than floating under the table.
   *
   * A note below the table reads correctly while exactly one row has a reason,
   * and cannot say which row it means as soon as two do.
   */
  reason: Attribution;
}

export interface ProductRow {
  id: string;
  name: string;
  views: number;
  enquiries: number;
  /** Enquiries over views, 0..1. Null where nobody viewed it. */
  conversion: number | null;
  delta: Delta;
  /** Carried from `3i`. Drives the named products in the median note. */
  noCoverPhoto: boolean;
  /** Carried from `3g`. Null unless it is out of stock now. */
  outOfStockDays: number | null;
}

/** A region row, keyed by emirate or by the honest absence of one. */
export type RegionKey = Emirate | "not_stated";

export interface DeviceSplit {
  mobile: number;
  desktop: number;
  tablet: number;
  total: number;
}

export interface MedianNote {
  /** The seller's own search-to-click rate, 0..1. */
  yours: number;
  /** The cohort median, 0..1. */
  median: number;
  cohortSize: number;
}

export interface AnalyticsSummary {
  window: Window;
  /** The first day any funnel stage has data for. Null when there is none. */
  trackingSince: Date | null;
  /** True when the previous period has nothing to compare against. Week one. */
  weekOne: boolean;
  /** True when nothing has been measured at all. The setup-gap state. */
  noData: boolean;
  stages: FunnelStage[];
  queries: QueryRow[];
  /** A query with volume the seller has no product for. Demand only — `B6`. */
  demandGap: { query: string; volume: number } | null;
  products: ProductRow[];
  regions: ShareRow<RegionKey>[];
  devices: DeviceSplit;
  /** Null below the cohort floor, which is `B5` and not a rendering choice. */
  median: MedianNote | null;
}

/** How many rows each panel carries. The board's counts. */
const TOP_QUERIES = 6;
const TOP_PRODUCTS = 5;

/**
 * Everything the analytics page renders.
 *
 * The capability is `analytics.see`, and the *scope* is board 7d's: a sales seat
 * sees their own leads rather than the whole business, and a finance seat does
 * not hold the row at all. `analyticsScopeFor` is the same function the previous
 * version of this screen narrowed by, so the two cannot narrow differently.
 */
export async function analyticsSummary(
  actor: Actor,
  businessId: string,
  now = new Date(),
): Promise<AnalyticsSummary | null> {
  /*
     `analytics.read` — board 7d, and the scope below is the other half of it.

     The capability answers *may this seat open the page at all*; the scope
     answers *how much of it*. A sales seat holds the capability and a narrowed
     scope, a finance seat holds neither, and collapsing the two into a boolean
     is what made the previous version invent its own narrowing.
  */
  assertCanReadAnalytics(actor);
  if (actor.businessId !== businessId) return null;

  const scope = analyticsScopeFor(actor);
  if (!scope) return null;

  const win = windowFor(now);
  const fromDay = dubaiDayStart(win.from);
  const previousFromDay = dubaiDayStart(win.previousFrom);

  const [current, previous, queries, products, regions, devices, earliest, median] =
    await Promise.all([
      stageCounts(businessId, win.from, win.to, scope),
      stageCounts(businessId, win.previousFrom, win.previousTo, scope),
      queryRows(businessId, fromDay, previousFromDay),
      productRows(businessId, fromDay, previousFromDay, win),
      regionRows(businessId, win, scope),
      deviceSplit(businessId, fromDay),
      firstTrackedDay(businessId),
      medianNote(businessId, fromDay),
    ]);

  /*
     Week one is a state, not an error.

     The previous period has nothing in it, so every change reads *no comparison
     yet* and the median note is suppressed. Board 3l is explicit that this is
     the state the page will spend its first month in, and that it renders as a
     normal page.
  */
  const previousTotal = Object.values(previous).reduce((sum, value) => sum + value, 0);
  const currentTotal = Object.values(current).reduce((sum, value) => sum + value, 0);

  return {
    window: win,
    trackingSince: earliest,
    weekOne: previousTotal === 0 && currentTotal > 0,
    noData: currentTotal === 0 && previousTotal === 0,
    stages: funnel(current, previousTotal === 0 ? null : previous),
    queries,
    demandGap: await demandGap(businessId, fromDay),
    products,
    regions,
    devices,
    median: previousTotal === 0 ? null : median,
  };
}

/**
 * The five stage counts over one half of the window.
 *
 * Three come from rollups this board introduced and two from the transactional
 * tables that already had them. The two are not rolled up because they are
 * low-volume and already indexed by `businessId, createdAt` — an enquiry is a
 * business event, not a page view, and there is no traffic-shaped growth to
 * bound.
 */
async function stageCounts(
  businessId: string,
  from: Date,
  to: Date,
  scope: AnalyticsScope,
): Promise<StageCounts> {
  const fromDay = dubaiDayStart(from);
  const toDay = dubaiDayStart(to);

  /*
     "Own leads only" narrows the two stages that have an actor behind them.

     Board 7d gives a sales seat their own leads rather than the whole picture.
     Impressions, clicks and product views have no actor at all — nobody
     "owns" an impression — so they are not narrowed, and the panel is honest
     that the last two stages are the scoped ones.
  */
  const ownLeads =
    scope.kind === "own_leads"
      ? { enquiry: { messages: { some: { businessId, senderId: scope.actorId } } } }
      : {};

  const [impressions, clicks, productViews, reveals, enquiries] = await Promise.all([
    prisma.searchImpressionDay.aggregate({
      where: { businessId, day: { gte: fromDay, lt: toDay } },
      _sum: { impressions: true },
    }),
    prisma.listingViewDay.aggregate({
      where: { businessId, day: { gte: fromDay, lt: toDay } },
      _sum: { views: true },
    }),
    prisma.productViewDay.aggregate({
      where: { businessId, day: { gte: fromDay, lt: toDay } },
      _sum: { views: true },
    }),
    prisma.contactReveal.count({ where: { businessId, createdAt: { gte: from, lt: to } } }),
    prisma.enquiryRecipient.count({
      where: { businessId, createdAt: { gte: from, lt: to }, ...ownLeads },
    }),
  ]);

  return {
    impressions: impressions._sum.impressions ?? 0,
    clicks: clicks._sum.views ?? 0,
    product_views: productViews._sum.views ?? 0,
    reveals,
    enquiries,
  };
}

/**
 * The queries a seller appeared for, with position and movement.
 *
 * Position is the best rank held in the window, and movement is that against
 * the best rank held in the previous one. A query with no impressions in the
 * previous window has no movement rather than a movement of zero — *not ranked*
 * is a state and not a bad rank, which is the board's own correction: `n/a` was
 * coloured the same red as `#14`.
 */
async function queryRows(
  businessId: string,
  fromDay: Date,
  previousFromDay: Date,
): Promise<QueryRow[]> {
  const [current, previous] = await Promise.all([
    prisma.searchImpressionDay.groupBy({
      by: ["normalised"],
      where: { businessId, day: { gte: fromDay } },
      _sum: { impressions: true },
      _min: { bestRank: true },
      // The most recent count of what the phrase returns, not the largest the
      // set has ever been. A category that shed listings did shed them.
      _max: { resultTotal: true, day: true },
      orderBy: { _sum: { impressions: "desc" } },
      take: TOP_QUERIES,
    }),
    prisma.searchImpressionDay.groupBy({
      by: ["normalised"],
      where: { businessId, day: { gte: previousFromDay, lt: fromDay } },
      _min: { bestRank: true },
    }),
  ]);

  const before = new Map(previous.map((row) => [row.normalised, row._min.bestRank]));

  /*
     The two nights the two ranks were measured near.

     This panel compares a window against the window before it, which is board
     3l's own rule and not the card's first-snapshot-in-window rule — the two
     boards ask different questions and the amendment did not change either. So
     the factor rows to diff are the window boundaries: the last night of the
     previous window against the most recent night of this one.
  */
  const previousLastDay = new Date(fromDay.getTime() - DAY_MS);

  /*
     One attribution read per row, and only for rows that actually moved.

     `queryReason` returns `none` without touching the database where there is
     nothing to compare, so a week-one page costs nothing extra — and a page of
     held positions costs nothing extra either, which is most pages.
  */
  return Promise.all(
    current.map(async (row) => {
      const was = before.get(row.normalised) ?? null;
      return {
        query: row.normalised,
        volume: row._sum.impressions ?? 0,
        position: row._min.bestRank,
        total: row._max.resultTotal ?? null,
        movement: placeChange(row._min.bestRank, was),
        reason: await queryReason({
          businessId,
          normalised: row.normalised,
          from: was === null ? null : previousLastDay,
          to: row._max.day ?? fromDay,
          positionBefore: was,
          positionAfter: row._min.bestRank,
        }),
      };
    }),
  );
}

/**
 * The queries with real volume that this seller has no product for.
 *
 * Build note `B6`, and it claims only what we know. *"88 buyers searched X and
 * you have no product listed for it"* is ours to say; *"you stock them"* was
 * not — nothing in the product knows a seller's unlisted inventory, and the
 * board asserted it anyway.
 *
 * Matched against the seller's own live product names rather than against the
 * catalogue at large: the question is whether *they* have something listed.
 */
async function demandGap(
  businessId: string,
  fromDay: Date,
): Promise<{ query: string; volume: number } | null> {
  const top = await prisma.searchImpressionDay.groupBy({
    by: ["normalised"],
    where: { businessId, day: { gte: fromDay } },
    _sum: { impressions: true },
    orderBy: { _sum: { impressions: "desc" } },
    take: TOP_QUERIES * 2,
  });
  if (top.length === 0) return null;

  const products = await prisma.product.findMany({
    where: { businessId, status: "live" },
    select: { name: true },
  });
  const haystack = products.map((product) => product.name.toLowerCase());

  for (const row of top) {
    /*
       Every *product* word has to appear in a product name, and place names are
       not product words.

       The first version required every word, and reported that a seller
       stocking "Grooved butterfly valve DN100" had no product for
       `grooved butterfly valve dubai` — because "dubai" is not in the name. A
       buyer naming their emirate is saying where they are, not what they want,
       and the panel claiming otherwise is exactly the unsourced assertion this
       note exists to avoid. It is the shape the board already got wrong once
       with *"you stock them"*.

       The other direction is also wrong: matching on *any* word reports no gap
       for `valve stem extension` because the seller lists a butterfly valve.
       Every remaining word, and only the remaining ones.
    */
    const words = row.normalised
      .split(" ")
      .filter((word) => word.length > 2 && !PLACE_WORDS.has(word));
    if (words.length === 0) continue;
    const covered = haystack.some((name) => words.every((word) => name.includes(word)));
    if (!covered) return { query: row.normalised, volume: row._sum.impressions ?? 0 };
  }

  return null;
}

/**
 * Words that say where a buyer is rather than what they want.
 *
 * The seven emirates, the country, and the handful of trade areas that turn up
 * in search phrases often enough to matter. Kept here rather than read from the
 * `area` table on purpose: this is a stop-list for one string comparison, and a
 * query against four hundred area names to answer it would be a join in aid of
 * a `Set.has`.
 */
const PLACE_WORDS = new Set([
  "uae",
  "emirates",
  "dubai",
  "sharjah",
  "ajman",
  "fujairah",
  "umm",
  "quwain",
  "ras",
  "khaimah",
  "abu",
  "dhabi",
  "quoz",
  "jafza",
  "dmcc",
  "deira",
  "musaffah",
  "sonapur",
]);

/**
 * Top products by enquiry, with the two flags that explain a row above them.
 *
 * The flags are carried from elsewhere in the product rather than invented
 * here: no cover photo is `3i`'s, out-of-stock duration is `3g`'s. Both are
 * causes a seller can act on, which is the only reason a flag belongs on an
 * analytics row at all.
 */
async function productRows(
  businessId: string,
  fromDay: Date,
  previousFromDay: Date,
  win: Window,
): Promise<ProductRow[]> {
  const [views, previousViews, enquiryLines, previousLines] = await Promise.all([
    prisma.productViewDay.groupBy({
      by: ["productId"],
      where: { businessId, day: { gte: fromDay } },
      _sum: { views: true },
      orderBy: { _sum: { views: "desc" } },
      take: TOP_PRODUCTS * 4,
    }),
    prisma.productViewDay.groupBy({
      by: ["productId"],
      where: { businessId, day: { gte: previousFromDay, lt: fromDay } },
      _sum: { views: true },
    }),
    prisma.enquiryLine.groupBy({
      by: ["productId"],
      where: {
        productId: { not: null },
        product: { businessId },
        enquiry: { createdAt: { gte: win.from, lt: win.to } },
      },
      _count: { _all: true },
    }),
    prisma.enquiryLine.groupBy({
      by: ["productId"],
      where: {
        productId: { not: null },
        product: { businessId },
        enquiry: { createdAt: { gte: win.previousFrom, lt: win.previousTo } },
      },
      _count: { _all: true },
    }),
  ]);

  const viewsBefore = new Map(previousViews.map((row) => [row.productId, row._sum.views ?? 0]));
  const enquiriesNow = new Map(enquiryLines.map((row) => [row.productId, row._count._all]));
  const enquiriesBefore = new Map(previousLines.map((row) => [row.productId, row._count._all]));

  const ids = views.map((row) => row.productId);
  if (ids.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      status: true,
      availability: true,
      updatedAt: true,
      media: { select: { mediaId: true }, take: 1 },
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const rows = views.flatMap((row) => {
    const product = byId.get(row.productId);
    if (!product) return [];

    const seen = row._sum.views ?? 0;
    const enquiries = enquiriesNow.get(product.id) ?? 0;
    const conversion = seen > 0 ? enquiries / seen : null;

    const seenBefore = viewsBefore.get(product.id) ?? 0;
    const conversionBefore =
      seenBefore > 0 ? (enquiriesBefore.get(product.id) ?? 0) / seenBefore : null;

    return [
      {
        id: product.id,
        name: product.name,
        views: seen,
        enquiries,
        conversion,
        delta: pointChange(conversion, conversionBefore),
        /*
           `3i`'s flag. A product with no media at all has no cover photo — the
           library treats the first image as the cover, so "has media" and "has
           a cover" are the same question until board 3i ships a chosen one.
        */
        noCoverPhoto: product.media.length === 0,
        /*
           `3g`'s flag, and it is deliberately approximate about *when*.

           Stock status has no history table, so the only date available is
           `updatedAt` — which moves for any edit. It is reported only while the
           product is actually out of stock, so the worst case is a duration
           that reads shorter than the truth. A number that can only understate
           is safe on a row a seller is being asked to act on; one that could
           overstate is not.
        */
        outOfStockDays:
          product.availability === "out_of_stock"
            ? Math.max(0, Math.floor((win.to.getTime() - product.updatedAt.getTime()) / 86_400_000))
            : null,
      },
    ];
  });

  return rows.sort((a, b) => b.enquiries - a.enquiries || b.views - a.views).slice(0, TOP_PRODUCTS);
}

/**
 * Where the enquiries came from.
 *
 * `Enquiry.emirate` — what the buyer picked on the composer — and never a
 * country guessed from an IP. A directory whose only asset is that its numbers
 * are true does not guess where a customer is, and the composer has always
 * asked; the write simply threw the answer away until this board.
 *
 * A null is `not_stated` and it renders as a row. Hiding it would make the
 * remaining shares add to 100% of a number that is not the total, which is the
 * padding rule in its most quietly wrong form.
 */
async function regionRows(
  businessId: string,
  win: Window,
  scope: AnalyticsScope,
): Promise<ShareRow<RegionKey>[]> {
  const ownLeads =
    scope.kind === "own_leads"
      ? { enquiry: { messages: { some: { businessId, senderId: scope.actorId } } } }
      : {};

  const read = async (from: Date, to: Date) => {
    const rows = await prisma.enquiryRecipient.findMany({
      where: { businessId, createdAt: { gte: from, lt: to }, ...ownLeads },
      select: { enquiry: { select: { emirate: true } } },
    });
    const counts = new Map<RegionKey, number>();
    for (const row of rows) {
      const key: RegionKey = row.enquiry.emirate ?? "not_stated";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const [current, previous] = await Promise.all([
    read(win.from, win.to),
    read(win.previousFrom, win.previousTo),
  ]);

  return shares<RegionKey>(current, previous.size > 0 ? previous : null);
}

/** The three buckets, over the window. Board `3l` keeps this on the page. */
async function deviceSplit(businessId: string, fromDay: Date): Promise<DeviceSplit> {
  const rows = await prisma.listingDeviceDay.groupBy({
    by: ["device"],
    where: { businessId, day: { gte: fromDay } },
    _sum: { views: true },
  });

  const of = (device: string) =>
    rows.find((row) => row.device === device)?._sum.views ?? 0;

  const mobile = of("mobile");
  const desktop = of("desktop");
  const tablet = of("tablet");
  return { mobile, desktop, tablet, total: mobile + desktop + tablet };
}

/**
 * The first day this seller has any measurement for.
 *
 * Drives `tracking since`. Three of the five stages could not be backfilled —
 * an impression that was not written is gone — so a page that showed a rise
 * from zero would be reporting the pipeline switching on as if it were growth.
 */
async function firstTrackedDay(businessId: string): Promise<Date | null> {
  const [impression, view] = await Promise.all([
    prisma.searchImpressionDay.findFirst({
      where: { businessId },
      orderBy: { day: "asc" },
      select: { day: true },
    }),
    prisma.listingViewDay.findFirst({
      where: { businessId },
      orderBy: { day: "asc" },
      select: { day: true },
    }),
  ]);

  const days = [impression?.day, view?.day].filter((day): day is Date => Boolean(day));
  if (days.length === 0) return null;
  return days.reduce((earliest, day) => (day < earliest ? day : earliest));
}

/**
 * The search-to-click rate against the cohort median. Build note `B5`.
 *
 * A cross-tenant aggregate shown to a seller, so the cohort has a floor and the
 * note does not render below it — a median over three suppliers identifies a
 * competitor. The cohort is category and emirate, which is spec Q3's
 * recommendation and matches both how buyers search and how `1c` ranks.
 */
async function medianNote(businessId: string, fromDay: Date): Promise<MedianNote | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      primaryCategoryId: true,
      locations: { where: { published: true }, select: { emirate: true }, take: 1 },
    },
  });
  if (!business) return null;

  const emirate = business.locations[0]?.emirate ?? null;

  const cohort = await prisma.business.findMany({
    where: {
      primaryCategoryId: business.primaryCategoryId,
      publishedAt: { not: null },
      suspendedAt: null,
      ...(emirate ? { locations: { some: { published: true, emirate } } } : {}),
    },
    select: { id: true },
  });
  if (!medianIsShowable(cohort.length)) return null;

  const ids = cohort.map((row) => row.id);
  const [impressions, clicks] = await Promise.all([
    prisma.searchImpressionDay.groupBy({
      by: ["businessId"],
      where: { businessId: { in: ids }, day: { gte: fromDay } },
      _sum: { impressions: true },
    }),
    prisma.listingViewDay.groupBy({
      by: ["businessId"],
      where: { businessId: { in: ids }, day: { gte: fromDay } },
      _sum: { views: true },
    }),
  ]);

  const clicksBy = new Map(clicks.map((row) => [row.businessId, row._sum.views ?? 0]));
  const rates: number[] = [];
  let yours: number | null = null;

  for (const row of impressions) {
    const seen = row._sum.impressions ?? 0;
    if (seen <= 0) continue;
    const rate = (clicksBy.get(row.businessId) ?? 0) / seen;
    rates.push(rate);
    if (row.businessId === businessId) yours = rate;
  }

  /*
     The floor applies to the businesses with a *rate*, not to the businesses in
     the category. A cohort of forty listings of which five have any impressions
     is a median over five, and the whole point of the floor is how many
     suppliers stand behind the number.
  */
  if (yours === null || !medianIsShowable(rates.length)) return null;

  rates.sort((a, b) => a - b);
  const middle = Math.floor(rates.length / 2);
  const median =
    rates.length % 2 === 0 ? (rates[middle - 1]! + rates[middle]!) / 2 : rates[middle]!;

  return { yours, median, cohortSize: rates.length };
}

export { percentChange, NO_COMPARISON };
