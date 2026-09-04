import { describe, expect, it } from "vitest";
import { countable, parseSearchQuery } from "@/lib/search/query";

/**
 * `countable` decides the facet-count cache key by deciding what to throw away.
 *
 * Both directions are a bug. Keeping a field that cannot change a count —
 * `page`, `sort`, `view` — fragments the cache into one entry per page of one
 * ordering, which is most of the traffic on a paginated shelf and would make the
 * cache nearly useless. Dropping a field that CAN change a count serves one
 * shelf's numbers on another, which is the kind of wrong a directory cannot
 * afford.
 *
 * So this asserts the exact set, rather than spot-checking a few fields.
 */
describe("countable", () => {
  const FULL = parseSearchQuery({
    q: "ductile iron",
    tab: "products",
    emirate: "dubai",
    area: "al-quoz-industrial-1",
    tier: "3",
    freeZone: "1",
    availability: "in_stock,made_to_order",
    replyWithinHours: "24",
    yearsTrading: "10",
    page: "7",
    sort: "rating",
    view: "grid",
    bounds: "55.1,25.0,55.4,25.3",
    cmtj5jbxc00cptcitmq1urzua: "DN80",
  });

  it("normalises exactly page, sort and view", () => {
    const out = countable(FULL);
    expect(out.page).toBe(1);
    expect(out.sort).toBe("best");
    expect(out.view).toBe("list");
  });

  it("keeps every field that can change a count", () => {
    const out = countable(FULL);
    const { page: _p, sort: _s, view: _v, ...rest } = FULL;
    for (const [key, value] of Object.entries(rest)) {
      expect(out[key as keyof typeof out], key).toEqual(value);
    }
  });

  it("keeps the spec bucket, because the products tab counts through it", () => {
    // `businessWhere` ignores `spec`; `productWhere` does not. Stripping it
    // would serve the unfiltered product count for every spec combination.
    expect(countable(FULL).spec).toEqual({ cmtj5jbxc00cptcitmq1urzua: ["DN80"] });
  });

  it("collapses every page, sort and view of one filter set to one key", () => {
    const key = (params: Record<string, string>) =>
      JSON.stringify(countable(parseSearchQuery({ emirate: "dubai", ...params })));

    const base = key({});
    const variants: Record<string, string>[] = [
      { page: "2" },
      { page: "40" },
      { sort: "rating" },
      { sort: "newest" },
      { view: "grid" },
      { page: "3", sort: "reply", view: "grid" },
    ];
    for (const variant of variants) {
      expect(key(variant), JSON.stringify(variant)).toBe(base);
    }
  });

  it("gives a different key to anything that changes the answer", () => {
    const key = (params: Record<string, string>) =>
      JSON.stringify(countable(parseSearchQuery(params)));

    const base = key({});
    const variants: Record<string, string>[] = [
      { emirate: "dubai" },
      { area: "al-quoz-industrial-1" },
      { tier: "3" },
      { freeZone: "1" },
      { availability: "in_stock" },
      { replyWithinHours: "24" },
      { yearsTrading: "10" },
      { q: "valve" },
      { tab: "products" },
      { bounds: "55.1,25.0,55.4,25.3" },
      { cmtj5jbxc00cptcitmq1urzua: "DN80" },
    ];
    for (const variant of variants) {
      expect(key(variant), JSON.stringify(variant)).not.toBe(base);
    }
  });
});
