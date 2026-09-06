import { describe, expect, it } from "vitest";
import {
  categoryIdsFor,
  countResults,
  getCategoryBySlug,
  readFixedFacetCounts,
} from "@/lib/db/queries/search";
import { parseSearchQuery, withoutFacet, type SearchQuery } from "@/lib/search/query";

/**
 * The nineteen fixed facet counts now come from one cached function rather than
 * nineteen live queries. These assert the numbers did not change.
 *
 * A directory's only asset is that its numbers are true, and a rail that says
 * "Dubai (41)" over a list of thirty-nine is worse than a rail with no counts on
 * it at all. So rather than trusting the refactor, recompute every count the
 * slow way and compare.
 *
 * The wrapper is Next's `unstable_cache`, which throws outside a request. These
 * call the uncached reader instead — the same split `readHomePlans` and
 * `readPricingPlans` already use. What is under test is the arithmetic, not
 * Next's cache.
 *
 * `optionCounts` measures each option with its OWN facet cleared; otherwise
 * every unpicked option would read zero the moment a buyer picked one, which is
 * the most common way a filter rail becomes useless. `oracle` reproduces that
 * rule independently, so a change to it fails here rather than shipping.
 */

/** The option lists, in the order `readFixedFacetCounts` returns their buckets. */
const GROUPS = [
  { key: "tier", values: ["4", "3", "2", "1"], bucket: "tiers" },
  { key: "emirate", values: ["dubai", "abu_dhabi", "sharjah", "ajman"], bucket: "emirates" },
  {
    key: "availability",
    values: ["in_stock", "made_to_order", "indent", "out_of_stock"],
    bucket: "availability",
  },
  { key: "freeZone", values: ["1"], bucket: "freeZone" },
  { key: "replyWithinHours", values: ["4", "24", "72"], bucket: "reply" },
  { key: "yearsTrading", values: ["5", "10", "20"], bucket: "years" },
] as const;

const APPLY: Record<string, (base: SearchQuery, value: string) => SearchQuery> = {
  tier: (base, v) => ({ ...base, tier: Number(v) }),
  emirate: (base, v) => ({ ...base, emirate: v }),
  availability: (base, v) => ({ ...base, availability: [v] }),
  freeZone: (base) => ({ ...base, freeZone: true }),
  replyWithinHours: (base, v) => ({ ...base, replyWithinHours: Number(v) }),
  yearsTrading: (base, v) => ({ ...base, yearsTrading: Number(v) }),
};

/** The same count, one query at a time, with nothing shared and nothing cached. */
async function oracle(
  query: SearchQuery,
  key: string,
  value: string,
  categoryIds: string[],
): Promise<number> {
  return countResults(APPLY[key]!(withoutFacet(query, key), value), categoryIds);
}

/**
 * Query shapes chosen so each exercises a different branch of `businessWhere`:
 * nothing, a location filter, a plain column, a relation, free text, and the
 * products tab where the counts come from `productWhere` instead.
 */
const SHAPES: Array<[string, Record<string, string>]> = [
  ["unfiltered", {}],
  ["one emirate", { emirate: "dubai" }],
  ["a tier", { tier: "3" }],
  ["availability", { availability: "in_stock" }],
  ["free zone", { freeZone: "1" }],
  ["a reply window", { replyWithinHours: "24" }],
  ["years trading", { yearsTrading: "5" }],
  ["free text", { q: "valve" }],
  ["two filters at once", { emirate: "dubai", tier: "2" }],
  ["the products tab", { tab: "products" }],
  ["a filter and a page", { emirate: "dubai", page: "3" }],
];

describe("the fixed facet counts survive being cached", () => {
  it.each(SHAPES)("matches a live count: %s", async (_name, params) => {
    const category = await getCategoryBySlug("valves-and-fittings");
    expect(category, "the seed must carry valves-and-fittings").not.toBeNull();
    const ids = categoryIdsFor(category!);

    const query = parseSearchQuery(params);
    const counts = await readFixedFacetCounts(query, ids);

    for (const group of GROUPS) {
      const bucket = counts[group.bucket];
      expect(bucket, group.key).toHaveLength(group.values.length);
      for (const [i, value] of group.values.entries()) {
        const expected = await oracle(query, group.key, value, ids);
        expect(bucket[i], `${group.key}=${value}`).toBe(expected);
      }
    }
  });

  it("clears each facet before counting its own options", async () => {
    /*
       The rule the whole rail depends on. With Dubai applied, the count beside
       "Sharjah" must be the number of Sharjah suppliers — not zero, which is
       what measuring with the emirate filter still applied would give.
    */
    const category = await getCategoryBySlug("valves-and-fittings");
    const ids = categoryIdsFor(category!);

    const withDubai = await readFixedFacetCounts(parseSearchQuery({ emirate: "dubai" }), ids);
    const unfiltered = await readFixedFacetCounts(parseSearchQuery({}), ids);

    // The emirate group ignores the emirate filter, so it reads identically
    // whether or not one is applied.
    expect(withDubai.emirates).toEqual(unfiltered.emirates);
  });
});

/**
 * The spec facets, which had none of this.
 *
 * They were parsed, rendered, counted and given a removable chip — and honoured
 * by nothing on the businesses tab, which is the default on every category
 * page. `productWhere` carried the branch; `businessWhere` did not.
 *
 * The counts had three separate faults beside it: measured over products even
 * when the tab counts businesses, measured with every spec field cleared rather
 * than only the field being counted, and sampled from an un-ordered
 * `take: 1000` above a thousand products with nothing on screen saying so.
 */
describe("a spec facet on the businesses tab", () => {
  /** The seeded valve template's filterable fields, and a value each. */
  async function aFilterableValue(): Promise<{ fieldId: string; value: string } | null> {
    const { prisma } = await import("@/lib/db/client");
    const field = await prisma.specField.findFirst({
      where: { isFilterable: true, options: { isEmpty: false }, template: { status: "live" } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, options: true },
    });
    if (!field) return null;

    // A value some product actually carries, so the assertions are not about
    // an empty set.
    for (const option of field.options) {
      const carried = await prisma.product.count({
        where: {
          status: { not: "draft" },
          OR: [
            { specValues: { path: [field.id], equals: option } },
            { specValues: { path: [field.id], array_contains: [option] } },
          ],
        },
      });
      if (carried > 0) return { fieldId: field.id, value: option };
    }
    return null;
  }

  it("narrows the businesses, rather than changing nothing", async () => {
    const pick = await aFilterableValue();
    if (!pick) return;

    const category = await getCategoryBySlug("valves-and-fittings");
    const ids = category ? categoryIdsFor(category) : undefined;

    const before = await countResults(parseSearchQuery({}), ids);
    const after = await countResults(
      parseSearchQuery({ [pick.fieldId]: pick.value }),
      ids,
    );

    /*
       The assertion the bug would have failed: with the facet honoured, a
       supplier stocking nothing of that spec drops out. Before this, the two
       numbers were identical for every value of every field.
    */
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  it("requires one product to satisfy every spec chip, not one product each", async () => {
    /*
       A supplier stocking a DN100 brass valve and a DN50 cast-iron one does not
       stock a DN100 cast-iron valve. Two `some` clauses would say they do, and
       the rail's two chips describe one product.
    */
    const { prisma } = await import("@/lib/db/client");
    const fields = await prisma.specField.findMany({
      where: { isFilterable: true, options: { isEmpty: false }, template: { status: "live" } },
      orderBy: { sortOrder: "asc" },
      take: 2,
      select: { id: true, options: true },
    });
    if (fields.length < 2) return;

    const category = await getCategoryBySlug("valves-and-fittings");
    const ids = category ? categoryIdsFor(category) : undefined;

    const both = parseSearchQuery({
      [fields[0]!.id]: fields[0]!.options[0]!,
      [fields[1]!.id]: fields[1]!.options[0]!,
    });

    const businesses = await countResults(both, ids);

    // Every business the pair returns must hold a single product carrying both.
    const holders = await prisma.business.count({
      where: {
        products: {
          some: {
            status: { not: "draft" },
            AND: [
              {
                OR: [
                  { specValues: { path: [fields[0]!.id], equals: fields[0]!.options[0]! } },
                  { specValues: { path: [fields[0]!.id], array_contains: [fields[0]!.options[0]!] } },
                ],
              },
              {
                OR: [
                  { specValues: { path: [fields[1]!.id], equals: fields[1]!.options[0]! } },
                  { specValues: { path: [fields[1]!.id], array_contains: [fields[1]!.options[0]!] } },
                ],
              },
            ],
          },
        },
      },
    });

    expect(businesses).toBeLessThanOrEqual(holders);
  });

  it("counts the rail in the unit the tab counts", async () => {
    /*
       A buyer on the businesses tab reads a header counting businesses and a
       list of businesses. Every number in the rail beside it counted products,
       so a facet could read 40 over a list of nine suppliers.
    */
    const { readSpecFacets } = await import("@/lib/db/queries/search");
    const category = await getCategoryBySlug("valves-and-fittings");
    if (!category) return;
    const ids = categoryIdsFor(category);

    const [asBusinesses, asProducts] = await Promise.all([
      readSpecFacets(ids, parseSearchQuery({}), ids),
      readSpecFacets(ids, parseSearchQuery({ tab: "products" }), ids),
    ]);
    if (asBusinesses.length === 0) return;

    for (const group of asBusinesses) {
      const mirror = asProducts.find((other) => other.key === group.key);
      for (const option of group.options) {
        const businesses = option.count;
        const products = mirror?.options.find((o) => o.value === option.value)?.count ?? 0;
        // One business can carry several matching products and never fewer.
        expect(businesses).toBeLessThanOrEqual(products);
        expect(businesses).toBeGreaterThan(0);
      }
    }
  });

  it("measures each option with its own field cleared and the others still applied", async () => {
    /*
       `optionCounts` has done this for the fixed facets since it shipped. The
       spec version cleared the whole bucket, so with two fields picked the
       second field's counts were measured as though the first were not — and
       the rail promised results the list did not have.
    */
    const { readSpecFacets } = await import("@/lib/db/queries/search");
    const pick = await aFilterableValue();
    const category = await getCategoryBySlug("valves-and-fittings");
    if (!pick || !category) return;
    const ids = categoryIdsFor(category);

    const unfiltered = await readSpecFacets(ids, parseSearchQuery({}), ids);
    const filtered = await readSpecFacets(
      ids,
      parseSearchQuery({ [pick.fieldId]: pick.value }),
      ids,
    );

    // The picked field's own options are unchanged: it was cleared to count them.
    const before = unfiltered.find((g) => g.key === pick.fieldId);
    const after = filtered.find((g) => g.key === pick.fieldId);
    if (before && after) {
      for (const option of before.options) {
        const now = after.options.find((o) => o.value === option.value);
        if (now) expect(now.count).toBe(option.count);
      }
    }

    // Every OTHER field is now measured under the picked constraint, so no
    // count may have risen.
    for (const group of filtered) {
      if (group.key === pick.fieldId) continue;
      const was = unfiltered.find((g) => g.key === group.key);
      for (const option of group.options) {
        const previous = was?.options.find((o) => o.value === option.value)?.count ?? 0;
        expect(option.count).toBeLessThanOrEqual(previous);
      }
    }
  });
});

describe("removing a filter chip", () => {
  it("clears the map viewport, which used to link to the page it was on", () => {
    /*
       `withoutFacet` had no `bounds` case, so it fell to the spec branch and
       deleted a key that does not exist — returning the query unchanged. The
       "Map area" chip rendered a remove link pointing at the URL it was already
       on: a control that looks like every other chip and cannot be dismissed.
    */
    const bounded: SearchQuery = parseSearchQuery({
      bounds: "24.9,55.0,25.3,55.4",
    });
    expect(bounded.bounds).toBeDefined();
    expect(withoutFacet(bounded, "bounds").bounds).toBeUndefined();
  });

  it("leaves the other filters alone when it clears one", () => {
    const query = parseSearchQuery({ emirate: "dubai", tier: "3" });
    const cleared = withoutFacet(query, "emirate");
    expect(cleared.emirate).toBeUndefined();
    expect(cleared.tier).toBe(3);
  });
});
