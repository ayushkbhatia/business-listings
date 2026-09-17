import { describe, expect, it } from "vitest";
import { CLICK_WEIGHT, bandScopes, scoreOf } from "./bands";

/**
 * The two arithmetic decisions inside the run, stated where they can be argued
 * with rather than left inside a SQL string.
 *
 * `runDemandBandsIn` itself needs a database and is covered by
 * `tests/integration/placement.test.ts`. What is here is the pair of rules that
 * decide what a seller is charged and that a reader of the SQL would have to
 * reconstruct: **appearances is a maximum, not a sum**, and **a click is worth
 * ten appearances**.
 */

describe("appearances is a maximum, not a sum", () => {
  /*
     `CategoryPositionDay` writes one row per listing shown and increments each
     of them, so summing the column counts loads × results: a trade that gains
     ten listings would appear to have gained ten times the buyers. The listing
     at position one is on every page-one load, so the maximum over a scope's
     listings on a day is the number of times buyers actually looked at it.

     This models both readings over the same day and shows they disagree by the
     size of the directory — which is the defect, in one number.
  */
  const listings = 12;
  const loads = 40;

  it("does not grow with the number of listings in the trade", () => {
    const asMaximum = loads;
    const asSum = loads * listings;
    expect(asSum).toBe(asMaximum * listings);
    // And the band cut from the second would put a trade with more suppliers
    // above a busier one with fewer.
    const banded = bandScopes([
      { categoryId: "many-listings", emirate: "dubai", appearances: asSum, clicks: 0 },
      { categoryId: "busier-trade", emirate: "dubai", appearances: loads * 6, clicks: 0 },
    ]);
    expect(banded[0]!.band).toBeGreaterThan(banded[1]!.band);
  });
});

describe("what a click is worth", () => {
  it("is ten appearances, and it is a ratio rather than a price", () => {
    /*
       A buyer being shown a page against a buyer choosing something out of it.
       Ten is a judgement and it is stated rather than buried: because the bands
       are cut by decile it only ever changes the *order* scopes come in, never
       the figure anybody is charged.
    */
    expect(scoreOf({ appearances: 0, clicks: 1 })).toBe(CLICK_WEIGHT);
    const quiet = { categoryId: "browsed", emirate: null, appearances: 90, clicks: 0 };
    const acted = { categoryId: "acted-on", emirate: null, appearances: 20, clicks: 8 };
    const banded = bandScopes([quiet, acted]);
    expect(banded[1]!.band).toBeGreaterThan(banded[0]!.band);
  });
});
