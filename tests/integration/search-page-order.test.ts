import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { businessWhere, searchBusinesses, PAGE_SIZE, relevanceOf } from "@/lib/db/queries/search";
import { liveBoosts } from "@/lib/search/boosts";
import { nearestKm } from "@/lib/geo/distance";
import { resolveOrigin } from "@/lib/search/origin";
import { measurable } from "@/lib/locations/branch";
import { rank, type RankSignals } from "@/lib/search/ranking";
import { liveVectors } from "@/lib/search/settings";
import { parseSearchQuery } from "@/lib/search/query";
import { resolveTradeKind } from "@/lib/taxonomy/trade-kind";
import { getTradeKinds } from "@/lib/taxonomy/service";

/**
 * T2.2's acceptance criterion: the page Postgres orders **is** the true order.
 *
 * The old path took two hundred rows with no `orderBy` and ranked those, so
 * "page one" was the best of an arbitrary sample. Asserting the new path
 * against the old one would therefore assert the defect. What this asserts
 * instead is the property the defect broke:
 *
 *   · page one is the top twenty of the **whole** matched set, scored by the
 *     ranker itself, not by a second opinion;
 *   · page two is the next twenty, and it is not empty;
 *   · the two do not overlap, and together they are the top forty.
 *
 * The reference order is computed in the process over every matched row —
 * which is exactly the read `docs/production-build-plan.md` §13 forbids on a
 * request path, and is perfectly fine in a test.
 */

/** Every matched listing, ranked in the process, as the reference order. */
async function referenceOrder(params: Record<string, string>): Promise<string[]> {
  const query = parseSearchQuery(params);
  const [rows, vectors, boosts, kinds, origin] = await Promise.all([
    prisma.business.findMany({
      where: businessWhere(query),
      orderBy: [{ id: "asc" }],
      select: {
        id: true,
        displayName: true,
        searchText: true,
        verificationTier: true,
        responseTimeMedianMs: true,
        specCompleteness: true,
        primaryCategoryId: true,
        plan: { select: { rankingMultiplier: true } },
        // Published only, as the distance join filters: an unpublished branch
        // is not a place a buyer can be near.
        locations: {
          where: { published: true },
          select: { lat: true, lng: true, geocodePrecision: true },
        },
      },
    }),
    liveVectors(),
    liveBoosts(),
    getTradeKinds(),
    // The same origin the query resolves for itself. An emirate filter has
    // one, and a reference that passed null scored every distance as unknown
    // while the real path scored it — which is what first failed here.
    resolveOrigin(query),
  ]);

  // One vector in play unless a services one has been published, which is the
  // state every public surface is in today.
  const signalsOf = (row: (typeof rows)[number]): RankSignals => ({
    relevance: relevanceOf(`${row.displayName} ${row.searchText ?? ""}`, query.q),
    verificationTier: row.verificationTier,
    responseTimeMedianMs: row.responseTimeMedianMs,
    specCompleteness: row.specCompleteness,
    distanceKm: nearestKm(origin, measurable(row.locations)),
    planMultiplier: row.plan?.rankingMultiplier ?? 1,
    boostPoints: boosts.get(row.id) ?? 0,
  });

  /*
     One vector. No services vector has ever been published, so every listing
     ranks on the goods one and the band merge is the identity — the state the
     whole directory is in until T5.9 seeds the first services vector.
  */
  void resolveTradeKind;
  void kinds;
  return rank(rows, signalsOf, vectors.goods, "goods").map((row) => row.id);
}

describe("the page Postgres orders is the true order", () => {
  for (const [name, params] of [
    ["no query", {}],
    ["one word", { q: "valves" }],
    ["one emirate", { emirate: "dubai" }],
  ] as [string, Record<string, string>][]) {
    it(`${name}: page one is the top ${String(PAGE_SIZE)} of the whole match`, async () => {
      const reference = await referenceOrder(params);
      const page = await searchBusinesses(parseSearchQuery(params));

      // A sponsored row is lifted to the front by `placeSponsored`, which would
      // make an exact comparison a comparison of two different things.
      expect(page.sponsoredId, "no sponsored slot on a bare query").toBeNull();
      expect(page.rows.map((row) => row.id)).toEqual(reference.slice(0, PAGE_SIZE));
    });

    it(`${name}: page two is the next ${String(PAGE_SIZE)}, and not empty`, async () => {
      const reference = await referenceOrder(params);
      if (reference.length <= PAGE_SIZE) return;

      const two = await searchBusinesses(parseSearchQuery({ ...params, page: "2" }));
      expect(two.rows.length).toBeGreaterThan(0);
      expect(two.rows.map((row) => row.id)).toEqual(reference.slice(PAGE_SIZE, PAGE_SIZE * 2));
    });
  }

  it("pages past the old two-hundred-row window instead of answering with nothing", async () => {
    /*
       The defect, as a test. The window was two hundred rows and a page is
       twenty, so page eleven onwards sliced off the end of it and returned
       nothing — beneath a total claiming nineteen hundred pages. Page fifteen
       is inside the ranked order now.
    */
    const total = await prisma.business.count({ where: businessWhere(parseSearchQuery({})) });
    if (total < 15 * PAGE_SIZE) return;

    const page = await searchBusinesses(parseSearchQuery({ page: "15" }));
    expect(page.rows.length).toBe(PAGE_SIZE);
    expect(page.total).toBe(total);

    const reference = await referenceOrder({});
    expect(page.rows.map((row) => row.id)).toEqual(reference.slice(14 * PAGE_SIZE, 15 * PAGE_SIZE));
  });

  it("says so when the page is past what the ranking orders, rather than going empty", async () => {
    // `MAX_PAGE_WINDOW`. Every caller reports the shortfall — the doctrine
    // `lib/search/directory.ts` already applies to `MAX_LISTINGS`.
    const deep = await searchBusinesses(parseSearchQuery({ page: "500" }));
    expect(deep.capped).toBe(true);
  });

  it("keeps a single-signal sort a real sort, paged", async () => {
    /*
       `orderFor`'s three sorts were applied to the same arbitrary two hundred,
       so "Fastest reply" returned the fastest of an accident. They are an
       `ORDER BY` now: claimed first, nulls last, the id as the tie-break.
    */
    const page = await searchBusinesses(parseSearchQuery({ sort: "reply" }));
    const replies = page.rows.map((row) => row.responseTimeMedianMs);
    const measuredPrefix = replies.filter((value): value is number => value !== null);
    expect([...measuredPrefix].sort((a, b) => a - b)).toEqual(measuredPrefix);

    const claimed = page.rows.map((row) => (row.claimStatus === "claimed" ? 0 : 1));
    expect([...claimed].sort()).toEqual(claimed);
  });
});
