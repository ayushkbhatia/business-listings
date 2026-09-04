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
