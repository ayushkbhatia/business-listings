import "server-only";
import type { Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { DEFAULT_BASE_PRICE_AED, DEFAULT_STEP_BPS, MIN_BAND, generateCard, priceForBand } from "./bands";
import { runDemandBandsIn, type DemandRunResult } from "./demand-run";

/**
 * Where a scope sits on the demand ladder, measured from the site's own traffic.
 *
 * Board `11e`: *"price tracks demand, not competition."* The figure it tracks is
 * **measured, never typed** — the owner's instruction on 17 Sep, and the same
 * doctrine every other number in this product follows. Two signals, both
 * already counted behind the crawler gate:
 *
 *   appearances  `CategoryPositionDay`, written when a real buyer loads a
 *                results page for a trade in an emirate
 *   clicks       `ScopeClickDay`, written when a buyer picks something out of
 *                those results
 *
 * ## Appearances is a maximum, not a sum
 *
 * `CategoryPositionDay` writes **one row per listing shown** and increments each
 * of them, so summing the column counts loads × results and grows with the
 * directory rather than with demand — a trade that gains ten listings would
 * appear to have gained ten times the buyers. The listing at position one is on
 * every page-one load, so the maximum over a scope's listings on a day is the
 * number of times buyers actually looked at it. That is what this reads.
 *
 * ## Monthly, on the first
 *
 * Ratified on 17 Sep against nightly. A quoted price that moves between a seller
 * reading the screen and coming back to it reads as arbitrary, and the invoice
 * history already implies the monthly cadence — placement moved 1,100 in July to
 * 1,400 in August, not day by day. A slot's price is frozen at booking either
 * way, so this only ever moves a quote.
 */

export type { DemandRunResult };

/**
 * Cut the bands on the app's client. The nightly route's entry point.
 *
 * The classifier itself is `runDemandBandsIn`, which the seed also runs — so a
 * freshly seeded database already holds what the first of the month would have
 * written, rather than a table of bands somebody hand-copied.
 */
export async function runDemandBands(now: Date = new Date()): Promise<DemandRunResult> {
  return runDemandBandsIn(prisma, now);
}

/** What a scope is, as the screen and the sale both need it. */
export interface ScopePrice {
  categoryId: string;
  emirate: Emirate | null;
  band: number;
  monthlyPriceAed: number;
  /** Null where this scope has never been measured. Never a zero standing in for one. */
  appearances: number | null;
  clicks: number | null;
  /** The last day of the window the band was cut from. Null where unmeasured. */
  measuredTo: Date | null;
}

export interface RateCard {
  basePriceAed: number;
  stepBps: number;
  /** Band to price, every rung present. */
  priceOf: (band: number) => number;
}

/**
 * The rate card, from rows.
 *
 * Falls back to the ratified curve where a row is missing rather than refusing
 * to price: a rate card with a hole in it is a screen that cannot quote, and the
 * generated price is the same number the migration seeded.
 */
export async function rateCard(): Promise<RateCard> {
  const [pricing, rows] = await Promise.all([
    prisma.placementPricing.findUnique({ where: { id: "current" } }),
    prisma.placementBand.findMany({ select: { band: true, monthlyPriceAed: true } }),
  ]);

  const basePriceAed = pricing?.basePriceAed ?? DEFAULT_BASE_PRICE_AED;
  const stepBps = pricing?.stepBps ?? DEFAULT_STEP_BPS;
  const byBand = new Map(rows.map((row) => [row.band, row.monthlyPriceAed]));

  return {
    basePriceAed,
    stepBps,
    priceOf: (band) => byBand.get(band) ?? priceForBand(band, basePriceAed, stepBps),
  };
}

/**
 * What these scopes cost, and what put them there.
 *
 * A scope with no band row is band 1 at the floor, with its measurement null
 * rather than zero — "we have not measured this" and "nobody visited this" are
 * different sentences and the screen says whichever is true.
 */
export async function priceScopes(
  scopes: readonly { categoryId: string; emirate: Emirate | null }[],
): Promise<ScopePrice[]> {
  if (scopes.length === 0) return [];

  const categoryIds = [...new Set(scopes.map((scope) => scope.categoryId))];
  const [card, bands] = await Promise.all([
    rateCard(),
    prisma.scopeDemandBand.findMany({
      where: { categoryId: { in: categoryIds } },
      select: {
        categoryId: true,
        emirate: true,
        band: true,
        appearances: true,
        clicks: true,
        measuredTo: true,
      },
    }),
  ]);

  const key = (categoryId: string, emirate: Emirate | null) => `${categoryId}:${emirate ?? ""}`;
  const measured = new Map(bands.map((row) => [key(row.categoryId, row.emirate), row]));

  return scopes.map((scope) => {
    const row = measured.get(key(scope.categoryId, scope.emirate));
    const band = row?.band ?? MIN_BAND;
    return {
      categoryId: scope.categoryId,
      emirate: scope.emirate,
      band,
      monthlyPriceAed: card.priceOf(band),
      appearances: row?.appearances ?? null,
      clicks: row?.clicks ?? null,
      measuredTo: row?.measuredTo ?? null,
    };
  });
}

/** The ladder as the admin editor and the gallery both need it. */
export async function ladder(): Promise<{ band: number; monthlyPriceAed: number; override: boolean }[]> {
  const rows = await prisma.placementBand.findMany({
    orderBy: { band: "asc" },
    select: { band: true, monthlyPriceAed: true, override: true },
  });
  if (rows.length > 0) return rows;
  return generateCard().map((rung) => ({ ...rung, override: false }));
}
