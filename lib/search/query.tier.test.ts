import { describe, expect, it } from "vitest";
import { parseSearchQuery, toSearchParams } from "./query";
import { TOP_ACHIEVABLE_TIER } from "@/lib/verification";

/**
 * What an inbound `?tier=` is allowed to become.
 *
 * The facet rail stops at `TOP_ACHIEVABLE_TIER`, but the rail is not the only
 * thing that puts a tier in a URL. Bookmarks, inbound links and anything saved
 * before the ladder shortened still arrive carrying one, and what the parser
 * does with those is a decision rather than a detail.
 *
 * The decision: parse it to what it says, clamp only to keep an int4 from
 * overflowing, and never silently rewrite it to a rung the buyer did not ask
 * for. `toSearchParams` re-emits whatever comes out of here into every anchor
 * on the page and into the applied-filter chip, so a clamp to
 * `TOP_ACHIEVABLE_TIER` would leave the page stating a filter nobody set over
 * results matching a different one.
 */
describe("an inbound tier", () => {
  it("keeps a tier the rail still offers", () => {
    expect(parseSearchQuery({ tier: "2" }).tier).toBe(2);
    expect(parseSearchQuery({ tier: "1" }).tier).toBe(1);
  });

  it("keeps a rung the ladder no longer draws rather than quietly lowering it", () => {
    // An old bookmark. Trade references were cut and the CHECK narrowed to
    // 0..2, so nothing holds a 3 any more — which makes this an honest
    // zero-results page, a designed state, instead of tier-2 suppliers shown
    // under a URL that asked for something stricter.
    expect(parseSearchQuery({ tier: "3" }).tier).toBe(3);
    expect(parseSearchQuery({ tier: "3" }).tier).toBeGreaterThan(TOP_ACHIEVABLE_TIER);
    expect(toSearchParams(parseSearchQuery({ tier: "3" }))).toBe("tier=3");
  });

  it("clamps only what would overflow the column's int4", () => {
    // The clamp is a guard, not a policy: unclamped, these reach Prisma and
    // throw, where a filter nothing can satisfy should just return nothing.
    // Anything inside int4 is left saying what it says, 4 included.
    expect(parseSearchQuery({ tier: "4" }).tier).toBe(4);
    expect(parseSearchQuery({ tier: "9" }).tier).toBe(9);
    for (const value of ["2147483648", "9999999999"]) {
      expect(parseSearchQuery({ tier: value }).tier, value).toBe(2_147_483_647);
    }
  });

  it("drops a tier that is not a positive number at all", () => {
    for (const value of ["0", "-1", "abc", ""]) {
      expect(parseSearchQuery({ tier: value }).tier, value).toBeUndefined();
    }
  });
});
