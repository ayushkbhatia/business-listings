import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { searchBusinesses } from "@/lib/db/queries";
import { resolveOrigin, shapeOf, weightsForShape } from "@/lib/search/origin";
import { DEFAULT_WEIGHTS } from "@/lib/search/ranking";
import { EMIRATE_CENTRES, haversineKm } from "@/lib/geo/distance";
import { measurable } from "@/lib/locations/branch";
import type { SearchQuery } from "@/lib/search/query";

/**
 * Board 1c's distance signal, against a real database.
 *
 * Criterion 11 asks for exactly this: *"ranking reads the shared config; an
 * exact SKU match measurably reduces distance weight in a test."* Until this
 * board `distanceKm` was hardcoded null at both ranking call sites, so the
 * weight in that shared config had never once moved a result — the admin
 * editor showed a slider wired to nothing.
 */

const query = (over: Partial<SearchQuery> = {}) =>
  ({
    q: "",
    page: 1,
    sort: "best",
    tab: "businesses",
    spec: {},
    availability: [],
    freeZone: false,
    ...over,
  }) as SearchQuery;

afterAll(() => prisma.$disconnect());

describe("the sort origin comes from the buyer's filters, never their device", () => {
  it("has no origin when nothing has been narrowed", async () => {
    // The honest state, and the reason `scoreDistance` tolerates null: a buyer
    // who has told us nothing about where they are gets distance scored as
    // unknown rather than as a penalty.
    expect(await resolveOrigin(query())).toBeNull();
  });

  it("uses the emirate centre when an emirate is filtered", async () => {
    const origin = await resolveOrigin(query({ emirate: "dubai" }));
    expect(origin).not.toBeNull();
    expect(origin!.label).toBe("Dubai");
    expect(haversineKm(origin!, EMIRATE_CENTRES.dubai!)).toBeLessThan(0.001);
  });

  it("prefers the area's own coordinates over its emirate's centre", async () => {
    const area = await prisma.area.findFirst({
      where: { lat: { not: null }, lng: { not: null }, emirate: "dubai" },
      select: { slug: true, name: true, lat: true, lng: true },
    });
    if (!area) return; // No pinned Dubai area seeded; nothing to assert against.

    const origin = await resolveOrigin(query({ emirate: "dubai", area: area.slug }));
    expect(origin!.label).toBe(area.name);
    expect(origin!.lat).toBeCloseTo(area.lat!, 6);
  });
});

describe("criterion 11 — the query's shape moves the distance weight", () => {
  it("drops distance to 4 on an exact SKU", async () => {
    const product = await prisma.product.findFirst({
      where: { sku: { not: null }, status: { not: "draft" } },
      select: { sku: true },
    });
    expect(product?.sku, "the seed carries no SKU to search for").toBeTruthy();

    const shape = await shapeOf(query({ q: product!.sku! }));
    expect(shape).toBe("sku");

    const weights = weightsForShape(DEFAULT_WEIGHTS, shape);
    // Measurably reduced, which is the criterion's own word.
    expect(weights.distance).toBe(4);
    expect(weights.distance).toBeLessThan(DEFAULT_WEIGHTS.distance);
  }, 60_000);

  it("raises distance to 14 on a service query with no product behind it", async () => {
    // The board's own example. Nothing in any catalogue answers it, so the
    // useful signal is who is nearby enough to come out.
    const shape = await shapeOf(query({ q: "amc contractor sitewide" }));
    expect(shape).toBe("service");
    expect(weightsForShape(DEFAULT_WEIGHTS, shape).distance).toBe(14);
  }, 60_000);

  it("leaves every other weight exactly as staff set it", async () => {
    /*
     * The guard on scope. Distance is the only weight a query may move; if a
     * search quietly rewrote verification or plan tier, the admin editor would
     * be a suggestion rather than a setting — and board 12c is emphatic that
     * what money can buy is capped in one place.
     */
    for (const shape of ["sku", "spec", "service"] as const) {
      const moved = weightsForShape(DEFAULT_WEIGHTS, shape);
      expect({ ...moved, distance: 0 }).toEqual({ ...DEFAULT_WEIGHTS, distance: 0 });
    }
  });
});

describe("distance actually reaches the ranking", () => {
  it("reports the origin it ranked with", async () => {
    // Returned by the query rather than recomputed by the page, so the sort
    // strip cannot name a place the ranking did not use.
    const result = await searchBusinesses(query({ q: "valve", emirate: "dubai" }));
    expect(result.origin?.label).toBe("Dubai");
    expect(result.total).toBeGreaterThan(0);
  }, 60_000);

  it("scores a near supplier above a far one, all else held equal", async () => {
    /*
     * The end-to-end proof, and it is deliberately run through the real query
     * rather than through `scoreRow`. A unit test on the scorer passed happily
     * for months while the caller handed it null.
     */
    const dubai = await searchBusinesses(
      query({ q: "valve", emirate: "dubai" }),
      { weights: { ...DEFAULT_WEIGHTS, relevance: 0, verificationTier: 0, responseTime: 0, specCompleteness: 0, planTier: 0, distance: 100 } },
    );

    /*
       Reconstructed through `measurable`, which is the same filter the query
       ranked with — board 3c's third criterion.

       Reconstructing from every pinned branch instead is what this assertion
       used to do, and it stopped agreeing the moment `geocode_precision`
       existed: an approximate pin is the *area's* centre, so it produces a
       plausible number that the ranking correctly refused to use. Two different
       distances for one supplier, and the test would have been the one that was
       wrong.
    */
    const distances = dubai.rows.map((row) =>
      Math.min(
        ...measurable(row.locations)
          .filter((l) => l.lat !== null && l.lng !== null)
          .map((l) => haversineKm(EMIRATE_CENTRES.dubai!, { lat: l.lat!, lng: l.lng! })),
      ),
    );

    // Rows with a real distance must be in ascending order among themselves.
    // Infinity is a supplier with no branch we may measure — unpinned, or
    // pinned only to an area — which scores as unknown at half credit and so
    // legitimately sits wherever that lands it.
    const known = distances.filter((km) => Number.isFinite(km));
    expect(known.length, "no pinned suppliers matched, nothing to order").toBeGreaterThan(1);
    expect(known).toEqual([...known].sort((a, b) => a - b));
  }, 60_000);
});
