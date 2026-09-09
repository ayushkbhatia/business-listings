import "server-only";
import { Prisma, type DeviceKind, type Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { dubaiDayStart } from "@/lib/format";

/**
 * Board `3l` — the writers behind the analytics pipeline.
 *
 * Three of the five funnel stages had no source at all before this: nothing
 * recorded which businesses a search returned, and nothing anywhere counted a
 * buyer looking at a *product*. Those are not recoverable later — an impression
 * that was not written is gone — which is why the spec calls the event schema
 * the first deliverable and why these land with the screen rather than after it.
 *
 * ## Every one of them is a rollup, and none of them throws
 *
 * The grain is a business, a day, and whatever the panel groups by. A search
 * returning twenty listings costs twenty upserts rather than twenty rows, and
 * the thousandth repeat of a query costs an increment. `ListingViewDay` has
 * counted this way since board 8a and these are its siblings.
 *
 * Nothing here throws. A counter that takes down a results page is worse than a
 * counter that misses a row, and every caller is a page render or a beacon.
 *
 * ## The crawler gate is upstream, deliberately
 *
 * `Results.tsx` reads the user agent once and gates the search writes on it —
 * a bot walked 797 facet permutations of that page in 75 minutes on 2026-09-04.
 * These functions do not re-check: the markup served to a crawler must stay
 * byte-identical to the markup served to a buyer, so exactly one place decides,
 * and it is the place that already decided for `recordSearch`.
 */

/** How many results one page write will count. A page is 24; this is slack. */
const MAX_RESULTS_PER_WRITE = 60;

/** Lowercased, whitespace-collapsed. The same form `SearchQueryLog` groups on. */
export function normaliseQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Count one page of search results, per business, per query, per day.
 *
 * `businessIds` arrives **in the order the buyer saw them**, so the index is the
 * rank. Rank is one-based: a zero would read as better than first everywhere
 * the column is ordered, which is why the table has a check constraint for it.
 *
 * `bestRank` keeps the *lowest* rank the listing held that day rather than the
 * latest. A seller who was second in the morning and fortieth after a
 * competitor's edit has a real story, and `least()` is what tells it — taking
 * the last value instead would make the number depend on when the buyer
 * happened to search.
 */
export async function recordSearchImpressions(
  businessIds: readonly string[],
  query: string,
  at: Date = new Date(),
  /** Rank of the row before the first of these. Page two starts at 20. */
  offset = 0,
  /**
   * How many listings the whole query returned, not how many this page held.
   *
   * `#2` is flattery in a set of three, and the cold start is the state this
   * platform launches in — so the amendment gives a query rank its denominator.
   * Null where the caller does not know it; the column stays nullable and the
   * row renders its rank alone rather than borrowing a number from a later day.
   */
  resultTotal: number | null = null,
): Promise<void> {
  const normalised = normaliseQuery(query);
  // A browse with no query is a category impression, not a search one — it has
  // no phrase to attribute a position to. `recordCategoryPositions` takes it.
  if (!normalised) return;

  const ids = businessIds.slice(0, MAX_RESULTS_PER_WRITE);
  if (ids.length === 0) return;

  const day = dubaiDayStart(at);

  try {
    /*
       One statement for the page rather than one round trip per result.

       `unnest` pairs each id with its rank, and the whole page lands as a single
       `INSERT … ON CONFLICT`. Twenty separate upserts would be twenty round
       trips on the render path of the busiest public page in the product.

       `result_total` takes the latest known denominator and never falls back to
       null: a second search for the same phrase later in the day is the more
       recent count of what it returns, and `coalesce` keeps the row's existing
       number where this caller had none — so a page that cannot supply it does
       not erase a page that could.
    */
    await prisma.$executeRaw`
      INSERT INTO "search_impression_day" ("business_id", "day", "normalised", "impressions", "best_rank", "result_total")
      SELECT id, ${day}::date, ${normalised}, 1, rank + ${offset}, ${resultTotal}::int
        FROM unnest(${ids}::text[]) WITH ORDINALITY AS t(id, rank)
      ON CONFLICT ("business_id", "day", "normalised") DO UPDATE
        SET "impressions" = "search_impression_day"."impressions" + 1,
            "best_rank"   = least("search_impression_day"."best_rank", EXCLUDED."best_rank"),
            "result_total" = coalesce(EXCLUDED."result_total", "search_impression_day"."result_total")
    `;
  } catch (cause) {
    console.error("[analytics] could not count search impressions", { normalised, cause });
  }
}

/**
 * Count one page of a category listing, per business, per day.
 *
 * The **other** position object, and the one board `3a`'s card reads. It is not
 * the same number as a query position and the spec is explicit that the two
 * must not share a table: `3a` is your rank in a category listing, and the query
 * panel is your rank for a phrase somebody typed.
 *
 * `emirate` is null when the buyer browsed the category across the whole
 * country. That is a real scope rather than missing data, so it is part of the
 * identity — and because a null never equals a null in SQL, the identity is two
 * partial unique indexes rather than one. The `ON CONFLICT` target has to name
 * the matching predicate, which is why this branches.
 *
 * ## What reads it, and what it is *not* the source of
 *
 * `lib/analytics/position.ts` reads it, and reads it for one thing: **which
 * scope a seller is browsed in**. A Dubai supplier may be browsed country-wide
 * in one category and filtered to Dubai in another, and only impressions know
 * which — so this supplies the scope and `CategoryRankDay`'s nightly snapshot
 * supplies the position.
 *
 * That division matters and it is the 3a/3l amendment's whole argument. This is
 * a **counter**: it writes when a real buyer loads a page, behind the crawler
 * gate. A category nobody browsed on Tuesday has no Tuesday row, so a movement
 * computed across that hole compares Monday to Thursday and calls it a day. The
 * snapshot exists because a position has to be computed whether anybody looked
 * or not; this exists because a snapshot cannot know where somebody looked
 * *from*.
 *
 * It spent a release written and read by nothing, which is worth remembering
 * rather than tidying away: board `3a`'s card was hidden pending `3l`, `3l`
 * landed, and the switch was not flipped until the amendment.
 */
export async function recordCategoryPositions(
  businessIds: readonly string[],
  categoryId: string,
  emirate: Emirate | null,
  at: Date = new Date(),
  /** Rank of the row before the first of these. Page two starts at 20. */
  offset = 0,
): Promise<void> {
  const ids = businessIds.slice(0, MAX_RESULTS_PER_WRITE);
  if (ids.length === 0) return;

  const day = dubaiDayStart(at);

  try {
    const rows = Prisma.sql`
      SELECT ${Prisma.raw("gen_random_uuid()::text")}, id, ${categoryId}, ${emirate}::"emirate",
             ${day}::date, rank + ${offset}, 1
        FROM unnest(${ids}::text[]) WITH ORDINALITY AS t(id, rank)
    `;

    if (emirate === null) {
      await prisma.$executeRaw`
        INSERT INTO "category_position_day" ("id", "business_id", "category_id", "emirate", "day", "position", "impressions")
        ${rows}
        ON CONFLICT ("business_id", "category_id", "day") WHERE "emirate" IS NULL DO UPDATE
          SET "impressions" = "category_position_day"."impressions" + 1,
              "position"    = least("category_position_day"."position", EXCLUDED."position")
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO "category_position_day" ("id", "business_id", "category_id", "emirate", "day", "position", "impressions")
        ${rows}
        ON CONFLICT ("business_id", "category_id", "day", "emirate") WHERE "emirate" IS NOT NULL DO UPDATE
          SET "impressions" = "category_position_day"."impressions" + 1,
              "position"    = least("category_position_day"."position", EXCLUDED."position")
      `;
    }
  } catch (cause) {
    console.error("[analytics] could not count category positions", { categoryId, cause });
  }
}

/**
 * Count one product view, on the day the supplier had.
 *
 * The funnel stage that had no source of any kind. `ProductEvent` is the
 * seller's own setup telemetry and has never counted a buyer looking at
 * anything.
 *
 * Counted from the browser through `/api/events`, not from the render — the
 * same rule `ListingViewDay` follows and for the same two reasons: the
 * framework may serve a product page from a cache, so a render is not a visit,
 * and a crawler that runs no JavaScript is not a buyer.
 *
 * The business is read from the product rather than taken from the caller. The
 * beacon is public and the payload decides nothing about identity.
 */
export async function recordProductView(
  productId: string,
  at: Date = new Date(),
): Promise<void> {
  try {
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        status: { not: "draft" },
        business: { publishedAt: { not: null }, suspendedAt: null },
      },
      select: { id: true, businessId: true },
    });
    if (!product) return;

    const day = dubaiDayStart(at);
    await prisma.productViewDay.upsert({
      where: { productId_day: { productId: product.id, day } },
      create: { productId: product.id, businessId: product.businessId, day, views: 1 },
      update: { views: { increment: 1 } },
    });
  } catch (cause) {
    console.error("[analytics] could not count a product view", { productId, cause });
  }
}

/**
 * Count what a storefront view happened on.
 *
 * Written beside `recordListingView` from the same beacon, so the split is over
 * exactly the views that were counted rather than a second, differently-gated
 * population. The bucket comes from the user agent on the beacon request, which
 * the server already has — nothing is asked of the client, because a client that
 * reports its own device class can report anything.
 */
export async function recordListingDevice(
  businessId: string,
  device: DeviceKind,
  at: Date = new Date(),
): Promise<void> {
  try {
    const day = dubaiDayStart(at);
    await prisma.listingDeviceDay.upsert({
      where: { businessId_day_device: { businessId, day, device } },
      create: { businessId, day, device, views: 1 },
      update: { views: { increment: 1 } },
    });
  } catch (cause) {
    console.error("[analytics] could not count a device", { businessId, cause });
  }
}
