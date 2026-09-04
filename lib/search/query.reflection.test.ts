import { describe, expect, it } from "vitest";
import { parseSearchQuery, toSearchParams } from "./query";

/**
 * The regression these guard is not "a wrong value was parsed". It is that the
 * page reflected an unknown parameter back into every anchor it rendered, so
 * one junk key forked the whole crawlable space beneath the shelf.
 *
 * A round-trip is the honest shape for the assertion: parse what arrived, then
 * serialise what the links would carry, and check the junk did not survive.
 */
function roundTrip(params: Record<string, string>): string {
  return toSearchParams(parseSearchQuery(params));
}

describe("the spec bucket is open to fields, not to callers", () => {
  it("keeps a real SpecField id", () => {
    // The exact key from the 2026-09-04 log.
    const q = parseSearchQuery({ cmtj5jbxc00cptcitmq1urzua: "DN80,DN200" });
    expect(q.spec).toEqual({ cmtj5jbxc00cptcitmq1urzua: ["DN80", "DN200"] });
  });

  it("drops Next's own internal route-parameter prefix", () => {
    // 27 of the 797 crawled URLs carried this. `nxtP` is Next's
    // NEXT_QUERY_PARAM_PREFIX; we were reading it off the request and linking
    // it back as though a buyer had chosen it.
    expect(parseSearchQuery({ nxtPcategory: "valves-and-fittings" }).spec).toEqual({});
    expect(roundTrip({ nxtPcategory: "valves-and-fittings" })).toBe("");
  });

  it("drops campaign tags, so our own marketing links stop forking the space", () => {
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "gclid", "fbclid", "ref"]) {
      expect(parseSearchQuery({ [key]: "x" }).spec).toEqual({});
      expect(roundTrip({ [key]: "x" })).toBe("");
    }
  });

  it("drops an invented key of any shape", () => {
    for (const key of ["zzz", "a", "Cmtj5jbxc00cptcitmq1urzua", "cSHORT", "x".repeat(40)]) {
      expect(parseSearchQuery({ [key]: "1" }).spec).toEqual({});
    }
  });

  it("still round-trips the real facets, filters and pagination untouched", () => {
    expect(
      roundTrip({
        cmtj5jbxc00cptcitmq1urzua: "DN80",
        emirate: "dubai",
        tier: "3",
        page: "2",
        sort: "rating",
        junk: "1",
      }),
    ).toBe("emirate=dubai&tier=3&cmtj5jbxc00cptcitmq1urzua=DN80&sort=rating&page=2");
  });
});
