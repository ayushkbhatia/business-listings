import { describe, expect, it } from "vitest";
import { parseSearchQuery, toSearchParams } from "./query";
import { MAX_STORED_TIER, TOP_ACHIEVABLE_TIER } from "@/lib/verification";

/**
 * What an inbound `?tier=` is allowed to become.
 *
 * The facet rail stopped offering tiers 3 and 4 — one is reserved and unbuilt,
 * the other is refused by `business_verification_tier_range` — but the rail is
 * not the only thing that puts a tier in a URL. Bookmarks, inbound links and
 * anything saved before the ladder shortened still arrive carrying one, and
 * what the parser does with those is a decision rather than a detail.
 *
 * The decision: parse it to what it says where the column could hold it, clamp
 * only to keep an int4 from overflowing, and never silently rewrite it to a
 * rung the buyer did not ask for. `toSearchParams` re-emits whatever comes out
 * of here into every anchor on the page and into the applied-filter chip, so a
 * clamp to `TOP_ACHIEVABLE_TIER` would leave the page stating a filter nobody
 * set over results matching a different one.
 */
describe("an inbound tier", () => {
  it("keeps a tier the rail still offers", () => {
    expect(parseSearchQuery({ tier: "2" }).tier).toBe(2);
    expect(parseSearchQuery({ tier: "1" }).tier).toBe(1);
  });

  it("keeps the reserved rung rather than quietly lowering it", () => {
    // An old bookmark. Tier 3 is drawn on the ladder and held by nobody, so
    // this yields an honest zero-results page — a designed state — instead of
    // showing tier-2 suppliers under a URL that asked for something stricter.
    expect(parseSearchQuery({ tier: "3" }).tier).toBe(3);
    expect(parseSearchQuery({ tier: "3" }).tier).toBeGreaterThan(TOP_ACHIEVABLE_TIER);
    expect(toSearchParams(parseSearchQuery({ tier: "3" }))).toBe("tier=3");
  });

  it("clamps a tier the column could never hold", () => {
    // The clamp is an int4 guard, not a policy: unclamped, these reach Prisma
    // and throw, where a filter nothing can satisfy should just return nothing.
    for (const value of ["4", "9", "2147483648", "9999999999"]) {
      expect(parseSearchQuery({ tier: value }).tier, value).toBe(MAX_STORED_TIER);
    }
  });

  it("drops a tier that is not a positive number at all", () => {
    for (const value of ["0", "-1", "abc", ""]) {
      expect(parseSearchQuery({ tier: value }).tier, value).toBeUndefined();
    }
  });
});
